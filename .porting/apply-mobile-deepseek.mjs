// Android v0.2+ uses a local-first runtime. The local overlay restores the
// mobile API adapter after every upstream rsync and constrains the packaged
// application to DeepSeek without requiring an AI-NOVEL server address.
import fs from "node:fs";
import "./apply-mobile-local.mjs";

// The release workflow invokes the normal client build. Append a mobile-only
// browser smoke test so a compile-successful but runtime-blank bundle cannot be released.
const packagePath = "client/package.json";
const clientPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const smokeCommand = "bash ../.porting/smoke-mobile-web.sh";
if (typeof clientPackage.scripts?.build === "string" && !clientPackage.scripts.build.includes(smokeCommand)) {
  clientPackage.scripts.build = `${clientPackage.scripts.build} && ${smokeCommand}`;
  fs.writeFileSync(packagePath, `${JSON.stringify(clientPackage, null, 2)}\n`, "utf8");
}
