import{c as y}from"./index-B1h53wyT.js";/**
 * @license lucide-react v0.298.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=y("Smartphone",[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]);function p(l){return Array.from(new Set(l.map(t=>String(t||"").trim()).filter(Boolean)))}function v(l,t=850){if(typeof window>"u")return;const i=typeof t=="number"?{stepDelayMs:t}:t||{},f=Number.isFinite(i.stepDelayMs)?Math.max(250,Number(i.stepDelayMs)):850,e=typeof i.onExhausted=="function"?i.onExhausted:void 0,n=p(l);if(n.length===0){e==null||e();return}let r=0,o=!1,u=!1,s=null;const a=()=>{s&&(window.clearTimeout(s),s=null),document.removeEventListener("visibilitychange",c)},c=()=>{document.visibilityState==="hidden"&&(o=!0,a())},d=()=>{if(u||o){a();return}u=!0,a(),e==null||e()},m=()=>{if(o||r>=n.length){d();return}const h=n[r];r+=1,window.location.assign(h),s=window.setTimeout(()=>{if(o||document.visibilityState!=="visible"){a();return}r<n.length?m():d()},f)};document.addEventListener("visibilitychange",c),m()}export{b as S,v as o};
