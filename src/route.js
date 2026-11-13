export function makeRoute(points){
  let total=0;
  const nodes=points.map((p,i)=>{if(i)total+=Math.hypot(...p.position.map((v,j)=>v-points[i-1].position[j]));return {...p,distance:total};});
  return {nodes,total};
}
export function routeAt(route,distance){
  const d=Math.max(0,Math.min(route.total,distance));let i=0;
  while(i<route.nodes.length-2&&route.nodes[i+1].distance<=d)i++;
  const a=route.nodes[i],b=route.nodes[i+1]||a,len=b.distance-a.distance;
  const t=len>1e-9?(d-a.distance)/len:0;
  const position=a.position.map((v,j)=>v+(b.position[j]-v)*t);
  const dx=b.position[0]-a.position[0],dz=b.position[2]-a.position[2],h=Math.hypot(dx,dz)||1;
  return {position,tangent:[dx/h,0,dz/h],normal:[-dz/h,0,dx/h],node:a,next:b,index:i,t,distance:d};
}
export function constrainedPosition(route,distance,lateral,halfWidth){
  const p=routeAt(route,distance),offset=Math.max(-halfWidth,Math.min(halfWidth,lateral));
  return {...p,position:p.position.map((v,i)=>v+p.normal[i]*offset),lateral:offset};
}
