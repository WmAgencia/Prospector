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


# The owner's original recording is OGG/Opus (OggS header), not AAC/MP4.
# Preserve the real MIME type in WhatsApp's PTT metadata so recipients can play
# the voice note reliably. Other voice formats retain the upstream behavior.
chat_service = Path("/app/src/modules/whatsapp/chat.service.ts")
source = chat_service.read_text()
voice_old = "content = { audio: buffer, mimetype: 'audio/mp4', ptt: true };"
voice_new = "content = { audio: buffer, mimetype: mimetype.startsWith('audio/ogg') ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: true };"
assert source.count(voice_old) == 1, "Unexpected upstream voice media metadata"
source = source.replace(voice_old, voice_new)
hook_old = "webhookMsg.message = { audioMessage: { mimetype: 'audio/mp4', ptt: type === 'voice' } };"
hook_new = "webhookMsg.message = { audioMessage: { mimetype: mimetype.startsWith('audio/ogg') ? 'audio/ogg; codecs=opus' : 'audio/mp4', ptt: type === 'voice' } };"
assert source.count(hook_old) == 1, "Unexpected upstream voice webhook metadata"
source = source.replace(hook_old, hook_new)
chat_service.write_text(source)
print("WA-AKG preserves OGG/Opus MIME for approved original WhatsApp voice messages")
