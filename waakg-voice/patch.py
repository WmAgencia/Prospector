#!/usr/bin/env python3
"""Attach native VoIP only through a runtime dynamic import, outside Next/Turbopack."""
from pathlib import Path
p=Path("/app/src/modules/whatsapp/instance.ts")
s=p.read_text()
old='        this.socket.ev.on("creds.update", saveCreds);'
assert s.count(old)==1, "WA-AKG socket anchor unexpectedly changed"
s=s.replace(old,'''        // Voice runtime is loaded in the custom WA-AKG Node process, never
        // bundled into Next.js routes. Shares THIS socket and Prisma auth.
        if (process.env.WA_AKG_CALLS_ENABLED === "true") {
            const callSocket = this.socket as WASocket;
            const moduleUrl = process.env.WA_AKG_CALL_MODULE_URL || "file:///app/voice-runtime/voice-calls.ts";
            void import(/* webpackIgnore: true */ moduleUrl)
                .then((m: any) => m.installFranciscaCalls(callSocket, this.sessionId))
                .catch((error: any) => logger.error("Instance", "Voice extension unavailable:", String(error?.message || error).slice(0,120)));
        }
'''+old)
p.write_text(s)
print("WA-AKG socket voice extension installed outside Next bundle")

# The upstream logout API only changes the session's DB status when no
# in-memory socket exists. Stale saved credentials otherwise reconnect
# without a new QR even after the operator intentionally logs out.
logout=Path("/app/src/app/api/sessions/[sessionId]/[action]/route.ts")
route=logout.read_text()
old_logout='''            case "logout":
                // Retrieve instance to logout properly
                const instance = waManager.getInstance(sessionId);
                if (instance?.socket) {
                    await instance.socket.logout();
                } else {
                    // Fallback DB update if instance not running
                    await prisma.session.update({
                        where: { sessionId },
                        data: { status: "LOGGED_OUT", qr: null }
                    });
                }
                break;'''
new_logout='''            case "logout": {
                // Attempt remote unlink, but a previously closed socket may reject.
                // Never report "logged out" while retaining an active socket or
                // persisted authentication credentials.
                const instance = waManager.getInstance(sessionId);
                if (instance?.socket) {
                    try {
                        await instance.socket.logout();
                    } catch {
                        console.warn("WA-AKG: disconnected socket refused remote logout; revoking local credentials");
                    }
                }
                await waManager.stopSession(sessionId);
                await prisma.$transaction([
                    prisma.session.update({
                        where: { sessionId },
                        data: { status: "LOGGED_OUT", qr: null }
                    }),
                    prisma.authState.deleteMany({ where: { sessionId } })
                ]);
                break;
            }'''
assert route.count(old_logout)==1, "WA-AKG logout implementation changed upstream"
logout.write_text(route.replace(old_logout,new_logout))
print("WA-AKG logout confirmed: remote unlink when possible, socket shutdown and auth revocation")

# Upstream runAutoMigration() always executes ALTER TABLE User even if the
# enum is already correct. On MySQL this takes a metadata lock and can block
# server.listen indefinitely when other long-lived connections hold the lock.
# The Docker CMD already runs prisma db push before the server starts.
migrate = Path("/app/src/lib/auto-migrate.ts")
migration_source = migrate.read_text()
role_ddl_anchor = "                        // Ensure default value is 'USER' and order is ('SUPERADMIN', 'STAFF', 'USER')"
role_ddl_end = "\n                    }\n                }\n            }\n        } else {"
assert migration_source.count(role_ddl_anchor) == 1, "Unexpected upstream enum migration"
start = migration_source.index(role_ddl_anchor)
end = migration_source.index(role_ddl_end, start)
migration_source = (
    migration_source[:start]
    + '                        logger.info("Database", "Role enum already synced; skipping redundant ALTER TABLE.");'
    + migration_source[end:]
)
migrate.write_text(migration_source)
print("WA-AKG runtime skips redundant User enum ALTER TABLE on already-current schema")

# The Prospector group starts with the creator only. The WA-AKG group-create
# route already calls Baileys groupCreate(subject, participants), but its Zod
# schema currently forbids an empty array. Permit [] for group creation only;
# member-update routes retain their own non-empty validation.
group_validation = Path("/app/src/lib/validations.ts")
validation_source = group_validation.read_text()
old_validation = 'participants: z.array(z.string().regex(/@s\\.whatsapp\\.net$/, "Invalid participant JID")).min(1, "At least one participant required")'
new_validation = 'participants: z.array(z.string().regex(/@s\\.whatsapp\\.net$/, "Invalid participant JID")).default([])'
assert validation_source.count(old_validation) == 1, "WA-AKG group-create schema anchor changed"
group_validation.write_text(validation_source.replace(old_validation,new_validation))
print("WA-AKG allows creator-only groups (participants: [])")


# Cloud media archive: preserve existing per-session authorization in media route.
hook=Path("/app/src/lib/webhook.ts")
webhook=hook.read_text()
import_anchor='import { logger } from "./logger";'
assert webhook.count(import_anchor)==1
webhook=webhook.replace(import_anchor,import_anchor+'\nimport {saveToArchive} from "./media-archive";')
write_anchor='        await writeFile(filePath, buffer);'
assert webhook.count(write_anchor)==1
webhook=webhook.replace(write_anchor,'''        // Cloud-first; local storage is only a temporary fallback.
        // Never discard an incoming file if remote upload fails.
        const archived = await saveToArchive(filename,buffer);
        if (!archived) await writeFile(filePath, buffer);''')
hook.write_text(webhook)
print("WA-AKG cloud-first private media storage installed")

media_route_path=Path("/app/src/app/api/media/[filename]/route.ts")
media_route=media_route_path.read_text()
marker='import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";'
assert media_route.count(marker)==1
media_route=media_route.replace(marker,marker+'\nimport {fetchFromArchive} from "@/lib/media-archive";')
old='''        if (!existsSync(filePath)) {
            return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
        }

        const fileBuffer = await readFile(filePath);'''
new='''        // Session ownership was checked above; the bucket is never public.
        const fileBuffer = existsSync(filePath) ? await readFile(filePath) : await fetchFromArchive(filename);
        if (!fileBuffer) {
            return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
        }'''
assert media_route.count(old)==1
media_route_path.write_text(media_route.replace(old,new))
print("WA-AKG private media read-through installed")

runtime=Path("/app/src/server/index.ts")
runtime_source=runtime.read_text()
runtime_anchor='import pkg from "../../package.json";'
assert runtime_source.count(runtime_anchor)==1
runtime_source=runtime_source.replace(runtime_anchor,runtime_anchor+'\nimport {startMediaArchiveWorker} from "../lib/media-archive";')
runtime_start='  server.listen(port, () => {'
assert runtime_source.count(runtime_start)==1
runtime_source=runtime_source.replace(runtime_start,'''  // Migrate previous local media only after cloud HEAD + SHA256 verification.
  startMediaArchiveWorker();
  server.listen(port, () => {''')
runtime.write_text(runtime_source)
print("WA-AKG safe media migration worker installed")

# Audio presented as a native WhatsApp push-to-talk voice note, not an
# audio attachment: audio/ogg; codecs=opus + ptt:true, with actual Opus data.
chat=Path("/app/src/modules/whatsapp/chat.service.ts")
chat_source=chat.read_text()
voice_source="content = { audio: buffer, mimetype: 'audio/mp4', ptt: true };"
assert chat_source.count(voice_source)==1
chat_source=chat_source.replace(voice_source,
 "content = { audio: buffer, mimetype: mimetype?.startsWith('audio/ogg') ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: true };")
webhook_media="webhookMsg.message = { audioMessage: { mimetype: 'audio/mp4', ptt: type === 'voice' } };"
assert chat_source.count(webhook_media)==1
chat_source=chat_source.replace(webhook_media,
 "webhookMsg.message = { audioMessage: { mimetype: type === 'voice' && mimetype?.startsWith('audio/ogg') ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: type === 'voice' } };")
chat.write_text(chat_source)
print("WA-AKG native voice notes honor ogg/opus mimetype")
