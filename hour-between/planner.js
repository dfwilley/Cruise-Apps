(function(root){
const rad=Math.PI/180;
function distance(a,b){const dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;return 6371*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2)))}
function minutes(t){if(!/^\d{2}:\d{2}$/.test(t))return NaN;const[h,m]=t.split(':').map(Number);return h<24&&m<60?h*60+m:NaN}
function budget(start,end,overnight){let a=minutes(start),b=minutes(end);if(!Number.isFinite(a+b))return NaN;if(overnight)b+=1440;return b-a}
function category(p){if(['cafe','restaurant','bakery','pub','bar','ice_cream','fast_food'].includes(p.kind)||p.group==='food')return 'taste';if(['museum','gallery','artwork'].includes(p.kind))return 'culture';if(['viewpoint','park','garden','nature_reserve'].includes(p.kind))return 'scenery';return 'discover'}
function plan(place,opts){const outKm=distance(opts.start,place)*opts.factor,backKm=distance(place,opts.end)*opts.factor;const out=opts.outOverride===null?Math.ceil(outKm/opts.speed*60):opts.outOverride,back=opts.backOverride===null?Math.ceil(backKm/opts.speed*60):opts.backOverride;const available=opts.total-out-back-opts.buffer-opts.extra;return {place,out,back,outKm,backKm,available,required:out+back+opts.buffer+opts.extra+opts.visit,fits:available>=opts.visit,spare:available-opts.visit,category:category(place)}}
function timeLabel(n){n=((Math.round(n)%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
const api={distance,minutes,budget,category,plan,timeLabel};if(typeof module!=='undefined')module.exports=api;else root.HourPlanner=api;
})(typeof window!=='undefined'?window:globalThis);
