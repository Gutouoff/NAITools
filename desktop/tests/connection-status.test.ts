import test from "node:test";
import assert from "node:assert/strict";
import {loadConnectionStatus} from "../src/features/connection-status.ts";

test("journal failure preserves independently loaded credential presence", async()=>{
  const [credentials,journal]=await loadConnectionStatus({credentialsStatus:async()=>true,listTasks:async()=>{throw {code:"storage_unavailable"};}});
  assert.deepEqual(credentials,{status:"fulfilled",value:true});
  assert.equal(journal.status,"rejected");
});
test("credential failure does not hide a successfully read journal",async()=>{
  const [credentials,journal]=await loadConnectionStatus({credentialsStatus:async()=>{throw {code:"credentials_unavailable"};},listTasks:async()=>[]});
  assert.equal(credentials.status,"rejected");
  assert.deepEqual(journal,{status:"fulfilled",value:[]});
});
