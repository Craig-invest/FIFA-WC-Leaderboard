/* mark-notified.mjs — run ONLY after the reminder email sends successfully.
 *
 * Moves the just-emailed match ids from data/.pending-email.json into
 * data/wc-notified.json so the same game is never emailed twice. Then clears
 * the pending-email artifacts. If there's nothing pending, it's a no-op.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const NOTIFIED_PATH = join(root, "data/wc-notified.json");
const EMAIL_HTML    = join(root, "data/.email-body.html");
const EMAIL_META    = join(root, "data/.pending-email.json");

if (!existsSync(EMAIL_META)) {
  console.log("[mark-notified] nothing pending — no-op.");
  process.exit(0);
}

const meta = JSON.parse(readFileSync(EMAIL_META, "utf8"));
let notified = { notified: [] };
try { notified = JSON.parse(readFileSync(NOTIFIED_PATH, "utf8")); } catch { /* none yet */ }

const set = new Set(notified.notified || []);
for (const id of meta.ids || []) set.add(id);

writeFileSync(NOTIFIED_PATH, JSON.stringify({ notified: [...set] }, null, 2) + "\n");
for (const f of [EMAIL_HTML, EMAIL_META]) if (existsSync(f)) rmSync(f);

console.log(`[mark-notified] recorded ${meta.ids?.length || 0} game(s) as emailed.`);
