#!/usr/bin/env python3
"""Fail-closed, narrowly-scoped voice import into a pinned WA-AKG source checkout."""
from pathlib import Path
p=Path("/app/src/modules/whatsapp/instance.ts")
s=p.read_text()
old='import { isInteractiveContent, handleInteractiveMessageDispatch } from "./interactive";'
assert s.count(old)==1, "Unexpected WA-AKG source: import anchor"
s=s.replace(old,old+'\nimport { installFranciscaCalls } from "./voice-calls";')
old='        this.socket.ev.on("creds.update", saveCreds);'
assert s.count(old)==1, "Unexpected WA-AKG source: socket anchor"
s=s.replace(old,'''        // Attach call signaling ONLY to the existing authenticated Baileys socket.
        // Feature flag is off by default; never open a competing connection.
        if (process.env.WA_AKG_CALLS_ENABLED === "true") {
            installFranciscaCalls(this.socket as WASocket, this.sessionId);
        }
'''+old)
p.write_text(s)
print("Voice call listener attached to original WA-AKG WASocket.")
