import{c as a}from"./index-CG9kpP9Y.js";/**
 * @license lucide-react v0.298.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n=a("Copy",[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]);async function i(t){var o;if(!t)return!1;try{if(typeof navigator<"u"&&((o=navigator.clipboard)!=null&&o.writeText))return await navigator.clipboard.writeText(t),!0}catch{}try{if(typeof document>"u"||!document.body)return!1;const e=document.createElement("textarea");e.value=t,e.setAttribute("readonly",""),e.style.position="fixed",e.style.left="-9999px",e.style.top="0",e.style.opacity="0",document.body.appendChild(e),e.focus({preventScroll:!0}),e.select(),e.setSelectionRange(0,e.value.length);const r=document.execCommand("copy");return e.remove(),r}catch{return!1}}export{n as C,i as c};
