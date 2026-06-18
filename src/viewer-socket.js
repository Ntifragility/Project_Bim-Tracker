import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';

let ws = null;
let lastReceivedGuid = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 5000;
const WS_URL = "ws://localhost:3001";

// Send measurement value to Excel over the WebSocket
export function sendMeasurementToExcel(value) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log(`[BIM Bridge] Transmitting measurement value to Excel: ${value}`);
    ws.send("value:" + value);
    return true;
  }
  console.warn("[BIM Bridge] WebSocket connection not open. Cannot send value.");
  return false;
}

// Helper: Zoom/fit camera to a specific element in the world
async function zoomToElement(components, world, model, expressId) {
  try {
    const bboxer = components.get(OBC.BoundingBoxer);
    bboxer.list.clear();
    await bboxer.addFromModelIdMap({ [model.uuid]: new Set([Number(expressId)]) });
    const box = bboxer.get();
    
    if (box && !box.isEmpty()) {
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      if (sphere.radius < 0.5) sphere.radius = 1.0;
      
      if (world.camera && world.camera.controls) {
        world.camera.controls.fitToSphere(sphere, true);
      }
    }
    bboxer.list.clear();
  } catch (e) {
    console.warn("[BIM Bridge] Zoom to element failed:", e);
  }
}

export function initExcelBridge(components, world) {
  const highlighter = components.get(OBF.Highlighter);
  
  function connect() {
    console.log(`[BIM Bridge] Connecting to WebSocket at ${WS_URL}...`);
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      console.log("[BIM Bridge] Connected to BIM Bridge WebSocket server.");
      reconnectDelay = 1000; // Reset backoff delay on successful connection
    };
    
    ws.onmessage = async (event) => {
      const rawMessage = String(event.data).trim();
      if (!rawMessage) return;
      
      // Ignore outgoing value messages
      if (rawMessage.startsWith("value:")) {
        return;
      }
      
      // Strip guid: prefix if present
      let cleanGuid = rawMessage;
      if (rawMessage.startsWith("guid:")) {
        cleanGuid = rawMessage.substring(5).trim();
      }
      
      console.log(`[BIM Bridge] Received selection request for GUID: ${cleanGuid}`);
      
      const fragments = components.get(OBC.FragmentsManager);
      let found = false;
      
      // Iterate through loaded models to locate which one contains the GUID
      for (const [modelId, model] of fragments.groups) {
        if (model.globalToExpressId && cleanGuid in model.globalToExpressId) {
          const expressId = model.globalToExpressId[cleanGuid];
          console.log(`[BIM Bridge] Resolved GUID ${cleanGuid} to Express ID ${expressId} in model: ${modelId}`);
          
          // Store received GUID so our onHighlight handler knows not to broadcast this back
          lastReceivedGuid = cleanGuid;
          
          // Select and highlight the component in 3D
          const selectedFragmentMap = model.getFragmentMap([expressId]);
          await highlighter.highlightByID("select", selectedFragmentMap, true);
          
          // Automatically focus and fit camera to the highlighted mesh
          zoomToElement(components, world, model, expressId);
          found = true;
          break;
        }
      }
      
      if (!found) {
        console.warn(`[BIM Bridge] GUID '${cleanGuid}' could not be matched to any elements in active models.`);
      }
    };
    
    ws.onclose = () => {
      console.warn(`[BIM Bridge] WebSocket connection lost. Reconnecting in ${reconnectDelay}ms...`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
    };
    
    ws.onerror = (err) => {
      console.error("[BIM Bridge] WebSocket error:", err);
    };
  }
  
  // Bidirectional Synchronization (3D element click -> select row in Excel)
  highlighter.events.select.onHighlight.add((fragmentMap) => {
    let selectedExpressId = null;
    
    if (fragmentMap && Object.keys(fragmentMap).length > 0) {
      const firstFragId = Object.keys(fragmentMap)[0];
      const ids = fragmentMap[firstFragId];
      if (ids) {
        selectedExpressId = ids instanceof Set ? Array.from(ids)[0] : ids[0];
      }
    }
    
    if (selectedExpressId !== null) {
      const fragments = components.get(OBC.FragmentsManager);
      let guid = null;
      
      // Locate the GUID of the selected component across all models
      for (const [modelId, model] of fragments.groups) {
        if (model.globalToExpressId) {
          for (const g in model.globalToExpressId) {
            if (model.globalToExpressId[g] === Number(selectedExpressId)) {
              guid = g;
              break;
            }
          }
        }
        if (guid) break;
      }
      
      if (guid) {
        // Skip broadcasting if this selection was triggered programmatically by the socket
        if (guid === lastReceivedGuid) {
          lastReceivedGuid = null; // Reset
          return;
        }
        
        lastReceivedGuid = null; // Reset on user-initiated click
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log(`[BIM Bridge] 3D Selection Event: Sending GUID '${guid}' to Excel...`);
          ws.send("guid:" + guid);
        }
      }
    }
  });

  highlighter.events.select.onClear.add(() => {
    lastReceivedGuid = null;
  });
  
  // Initialize the connection
  connect();
}
