export class ResourcePolicy {
  constructor(){this.state='unavailable';this.coolSince=null;this.sample=null;this.reason='Waiting for a valid CPU and GPU reading.';this.wasTripped=false;}
  update(sample,now=Date.now()){
    this.sample=sample;
    const cpu=sample?.cpuPercent,gpu=sample?.gpuPercent;
    const stamp=typeof sample?.sampledAt==='number'?sample.sampledAt:Date.parse(sample?.sampledAt);
    if(!Number.isFinite(cpu)||!Number.isFinite(gpu)||!Number.isFinite(stamp)||now-stamp>3500||stamp-now>2000||cpu<0||cpu>100||gpu<0||gpu>100){
      this.state='unavailable';this.reason='Resource monitoring is unavailable. Rendering is paused.';this.coolSince=null;return this.state;
    }
    const peak=Math.max(cpu,gpu);
    if(peak>=80){this.wasTripped=true;this.state='paused';this.coolSince=null;this.reason='Paused at the 80% resource limit.';return this.state;}
    if(this.wasTripped){
      if(peak<60){this.coolSince??=now;if(now-this.coolSince>=10000){this.wasTripped=false;this.state='reduced';this.reason='Resumed conservatively after ten seconds below 60%.';return this.state;}}
      else this.coolSince=null;
      this.state='paused';this.reason='Waiting for ten seconds below 60%.';return this.state;
    }
    this.state=peak>=70?'reduced':'normal';this.reason='';return this.state;
  }
  get canWork(){return this.state==='normal'||this.state==='reduced';}
}
