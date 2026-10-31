// One continuous water surface behind the page and the transparent hero panel.
// Procedural rendering keeps the animation local: no video downloads or third-party requests.
const canvas = document.getElementById('ocean');
const button = document.getElementById('motion-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
if (!gl) {
  canvas.hidden = true;
  button.hidden = true;
} else {
  const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
  const fragment = `precision mediump float;
    uniform vec2 resolution;
    uniform float time;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.;float a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=mat2(.8,-.6,.6,.8)*p*2.03+3.1;a*=.5;}return v;}
    void main(){
      vec2 uv=gl_FragCoord.xy/resolution.xy;
      vec2 p=gl_FragCoord.xy/resolution.y*5.;
      float t=time*.10;
      p+=vec2(t*.25,-t*.6);
      vec2 warp=vec2(fbm(p+vec2(t*.2,0)),fbm(p+vec2(4.2,t*.16)));
      vec2 q=p+warp*2.8;
      float swell=fbm(q*.85);
      float detail=fbm(q*3.+vec2(0,-t*.3));
      float veins=abs(sin((q.x*.7+q.y+fbm(q*1.5)*3.)*5.));
      float fine=fbm(q*12.);
      float foam=(1.-smoothstep(.025,.14,veins)) * smoothstep(.38,.68,detail);
      foam+= (1.-smoothstep(.015,.055,abs(detail-.53))) * smoothstep(.44,.65,fine)*.5;
      float wave=sin(p.y*1.4+p.x*.8-t*1.6+warp.x*3.);
      float crest=pow(max(0.,wave),12.);
      vec3 water=mix(vec3(.018,.055,.072),vec3(.055,.26,.25),smoothstep(.25,.8,swell));
      water+=vec3(.045,.11,.10)*crest;
      water=mix(water,vec3(.47,.69,.69),clamp(foam*(.4+crest*.8),0.,.8));
      water+=pow(max(0.,fine-.5)*2.,5.)*.12;
      float vignette=1.-.32*length(uv-.5);
      gl_FragColor=vec4(water*vignette,1.);
    }`;
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Water shader could not initialize');
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const resolution = gl.getUniformLocation(program,'resolution');
    const time = gl.getUniformLocation(program,'time');
    let paused = reducedMotion.matches, frame = 0, elapsed = 18, previous = 0;
    function draw(){gl.uniform1f(time,elapsed);gl.drawArrays(gl.TRIANGLES,0,6);}
    function resize(){
      const scale = Math.min(1, 1200 / innerWidth);
      canvas.width = Math.round(innerWidth*scale); canvas.height = Math.round(innerHeight*scale);
      gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(resolution,canvas.width,canvas.height);draw();
    }
    function animate(now){
      if(paused || document.hidden) return;
      if(now-previous>=32){elapsed+=Math.min((now-previous)/1000,.05);previous=now;draw();}
      frame=requestAnimationFrame(animate);
    }
    function sync(){
      cancelAnimationFrame(frame);previous=performance.now();
      button.textContent=paused?'Play water ▷':'Pause water Ⅱ';button.setAttribute('aria-pressed',String(paused));
      if(!paused && !document.hidden) frame=requestAnimationFrame(animate);
    }
    button.addEventListener('click',()=>{paused=!paused;sync();});
    reducedMotion.addEventListener('change',()=>{paused=reducedMotion.matches;sync();});
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('resize',resize);
    canvas.addEventListener('webglcontextlost',(event)=>{event.preventDefault();cancelAnimationFrame(frame);canvas.hidden=true;button.hidden=true;});
    resize();sync();
  } catch (error) {
    canvas.hidden=true;button.hidden=true;console.warn('Water animation unavailable:',error.message);
  }
}
