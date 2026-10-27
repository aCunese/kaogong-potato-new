// ==============================================================================
// Android Install State Machine Harness Template for V12 Regression Audit
// Source: output/audits/2026-10-27-independent-review/repro/Harness.template.java
// Injects handleInstallActivityResult from MainActivity.java into class body
// Used by: scripts/lib/boundary-checks.ts (runV12Check)
// ==============================================================================
import java.util.*;
class Harness {
 static class Activity { static int RESULT_OK=-1, RESULT_CANCELED=0; }
 static class Intent {}
 static class Log {static void i(String tag,String m){} }
 static class JSONObject {
  Map<String,Object> d=new LinkedHashMap<>();
  JSONObject put(String k,Object v){d.put(k,v); return this;}
  int optInt(String k,int v){return d.get(k) instanceof Number ? ((Number)d.get(k)).intValue() : v;}
  String optString(String k,String v){return d.containsKey(k)?String.valueOf(d.get(k)):v;}
  public String toString(){return d.toString();}
 }
 static String TAG="Test";
 static int STATE_IDLE=0, STATE_INSTALLED=6, STATE_INSTALLER_OPEN=5;
 int nativeUpdateState=STATE_INSTALLER_OPEN;
 JSONObject pendingInstallRequest=new JSONObject().put("versionCode",5).put("operationId","op_test");
 List<String> events=new ArrayList<>();
 int getInstalledVersionCode(){return 4;}
 void emitBridgeEvent(JSONObject evt){events.add(evt.toString());}
 void deleteUpdateArtifacts(){}
__ACTUAL_JAVA_METHOD__

 public static void main(String[] args){
  Harness h=new Harness();
  h.handleInstallActivityResult(1,new Intent());
  System.out.println("resultCode=RESULT_FIRST_USER(1), installed=4, target=5, nativeState="+h.nativeUpdateState+", emittedEvents="+h.events);
  if (h.nativeUpdateState != STATE_IDLE) throw new RuntimeException("Test 1 failed: nativeUpdateState != STATE_IDLE");
  if (h.events.isEmpty() || !h.events.get(0).contains("type=install_failed") || !h.events.get(0).contains("op_test")) {
    throw new RuntimeException("Test 1 failed: missing terminal failure event with operationId");
  }

  // Test 2: RESULT_OK but target version not reached (currentCode 4 < target 5) -> install_failed
  Harness h2 = new Harness();
  h2.handleInstallActivityResult(Activity.RESULT_OK, new Intent());
  if (h2.nativeUpdateState != STATE_IDLE || h2.events.isEmpty() || !h2.events.get(0).contains("type=install_failed")) {
    throw new RuntimeException("Test 2 failed: RESULT_OK without reaching target must emit install_failed");
  }

  // Test 3: RESULT_CANCELED -> install_cancelled
  Harness h3 = new Harness();
  h3.handleInstallActivityResult(Activity.RESULT_CANCELED, new Intent());
  if (h3.nativeUpdateState != STATE_IDLE || h3.events.isEmpty() || !h3.events.get(0).contains("type=install_cancelled")) {
    throw new RuntimeException("Test 3 failed: RESULT_CANCELED must emit install_cancelled");
  }

  // Test 4: Expired background result after cancel (pendingInstallRequest == null) -> no resurrection
  Harness h4 = new Harness();
  h4.pendingInstallRequest = null;
  h4.nativeUpdateState = STATE_IDLE;
  h4.handleInstallActivityResult(Activity.RESULT_OK, new Intent());
  if (!h4.events.isEmpty() || h4.nativeUpdateState != STATE_IDLE) {
    throw new RuntimeException("Test 4 failed: stale result must not revive task or emit events");
  }

  // Test 5: Target reached (installed = 5, target = 5) -> installed
  Harness h5 = new Harness() { int getInstalledVersionCode() { return 5; } };
  h5.handleInstallActivityResult(Activity.RESULT_OK, new Intent());
  if (h5.nativeUpdateState != STATE_INSTALLED || h5.events.isEmpty() || !h5.events.get(0).contains("type=installed")) {
    throw new RuntimeException("Test 5 failed: target reached must emit installed");
  }
  System.out.println("All A08 Harness assertions passed successfully.");
 }
}
