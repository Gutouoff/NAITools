import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const capability = JSON.parse(read("src-tauri/capabilities/main-local.json"));

test("native application identity and data are separated from legacy app", () => {
  assert.equal(config.identifier, "com.langbai.studio.pc.preview");
  assert.equal(config.app.withGlobalTauri, false);
});
test("only local main webview receives narrow application command permissions", () => {
  assert.deepEqual(config.app.security.capabilities, ["main-local"]);
  assert.deepEqual(capability.windows, ["main"]); assert.equal(capability.local, true);
  assert.equal(capability.remote, undefined);
  assert.deepEqual(capability.permissions, ["allow-desktop-bootstrap", "allow-desktop-mark-ready", "allow-draft-load", "allow-draft-save", "allow-history-list", "allow-history-request", "allow-generation-submit", "allow-credentials-status", "allow-credentials-set", "allow-credentials-delete", "allow-image-import", "allow-vibe-encode", "allow-artifact-read", "allow-artifact-export", "allow-task-list", "allow-task-acknowledge"]);
  // Registration must opt into AppManifest ACLs, not rely on default global command access.
  assert.ok(read("src-tauri/build.rs").includes("AppManifest::new().commands"));
});
test("production CSP excludes internet access and remote scripts", () => {
  const csp = config.app.security.csp;
  assert.ok(csp.includes("connect-src ipc: http://ipc.localhost"));
  assert.ok(!csp.includes("https:")); assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(csp.includes("object-src 'none'")); assert.ok(csp.includes("form-action 'none'"));
});
test("observed native subset is attributed without claiming real paid acceptance", () => {
  const evidence = JSON.parse(read("contracts/novelai-evidence.json"));
  assert.equal(evidence.status, "observed_subset"); assert.equal(evidence.generationEnabled, true);
  assert.equal(evidence.realPaidAcceptance, false);
  assert.ok(evidence.clientObservations.every((s: { classification: string }) => s.classification === "official_client_observation"));
  assert.equal(evidence.applicationLimits.maxVibes, 4);
  assert.ok(evidence.officialAttempts.some((s: { retrieved: boolean }) => s.retrieved));
  assert.ok(evidence.previousOfficialAttempts.every((s: { retrieved: boolean }) => !s.retrieved));
  for (const artifact of evidence.officialArtifacts) {
    const bytes = readFileSync(new URL(`../${artifact.file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
    const schema = JSON.parse(bytes.toString("utf8"));
    assert.equal(schema.swagger, "2.0");
    assert.ok(schema.paths["/ai/generate-image"].post);
  }
  assert.ok(evidence.unverifiedItems.length > 0);
  assert.ok(read("crates/studio-core/src/contract.rs").includes('verification:"observed_subset"'));
  assert.ok(read("crates/studio-core/src/generation.rs").includes("if !self.confirm_paid"));
  assert.ok(read("crates/studio-nai/src/lib.rs").includes("begin_remote_task"));
  assert.ok(read("crates/studio-nai/src/credentials.rs").includes("keyring"));
  assert.ok(evidence.legacyEvidence.every((s: { classification: string }) => s.classification === "existing_implementation_only"));
});
test("new UI does not pull in Electron, Python, ML runtimes or legacy app", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@tauri-apps/api", "react", "react-dom"]);
  const coreCargo = read("crates/studio-core/Cargo.toml");
  assert.ok(!coreCargo.includes("reqwest")); assert.ok(!coreCargo.includes("ureq"));
});

test("native transport disables automatic retries and redirects", () => {
  const transport = read("crates/studio-nai/src/http.rs");
  assert.ok(transport.includes(".retry(reqwest::retry::never())"));
  assert.ok(transport.includes(".redirect(Policy::none())"));
  assert.ok(transport.includes(".https_only(true)"));
  assert.ok(transport.includes("https://image.novelai.net/ai/generate-image"));
});

test("host owns window creation and separates disposable WebView cache from durable tasks", () => {
  assert.equal(config.app.windows[0].create, false);
  const host = read("src-tauri/src/main.rs");
  assert.match(host, /app\.path\(\)\.app_local_data_dir\(\)/);
  assert.match(host, /service: NaiService::new\(root\)/);
  assert.match(host, /\.data_directory\(cache\)/);
  assert.match(host, /startup::report_failure/);
  assert.doesNotMatch(host, /expect\("failed to start PC shell"\)/);
  const startup = read("src-tauri/src/startup.rs");
  assert.match(startup, /\.webview2-cache/);
  assert.match(startup, /startup-error\.log/);
  assert.doesNotMatch(startup, /credentials::|generation_submit|disable-web-security|--no-sandbox/);
});

test("branding changes preserve durable data and credential identity", () => {
  assert.equal(config.productName, "NAITools");
  assert.equal(config.app.windows[0].title, "NAITools");
  assert.equal(config.identifier, "com.langbai.studio.pc.preview");
  assert.match(read("crates/studio-nai/src/credentials.rs"), /SERVICE:&str="com\.langbai\.studio\.pc\.preview"/);
  assert.match(read("src-tauri/Cargo.toml"), /name = "naitools"/);
  assert.match(read("启动PC新版.cmd"), /naitools\.exe/);
});

test("local secrets and durable runtime data are excluded from source publication",()=>{
  const ignore=readFileSync(new URL("../.gitignore",import.meta.url),"utf8");
  for(const entry of [".env",".env.*","*.sqlite3","*.sqlite3-*","*.db","/outputs/","/vibes/","/assets/","target/","node_modules/"])assert.ok(ignore.split(/\r?\n/).includes(entry),`Missing ignore: ${entry}`);
});
