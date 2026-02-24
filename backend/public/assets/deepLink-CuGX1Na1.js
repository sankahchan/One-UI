import{c as u}from"./index-CcK4tOfC.js";/**
 * @license lucide-react v0.298.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=u("Smartphone",[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]);function d(n){return Array.from(new Set(n.map(o=>String(o||"").trim()).filter(Boolean)))}function f(n,o=850){if(typeof window>"u")return;const e=d(n);if(e.length===0)return;let t=0,r=!1,i=null;const l=()=>{i&&(window.clearTimeout(i),i=null),document.removeEventListener("visibilitychange",a)},a=()=>{document.visibilityState==="hidden"&&(r=!0,l())},c=()=>{if(r||t>=e.length){l();return}const s=e[t];t+=1,window.location.href=s,!(t>=e.length)&&(i=window.setTimeout(()=>{!r&&document.visibilityState==="visible"?c():l()},o))};document.addEventListener("visibilitychange",a),c()}export{m as S,f as o};
