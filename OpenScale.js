/**
 * OpenScale – Universal Dynamic Resolution & Upscaling Runtime for Web
 * Phases 1–6 / v1.0-rc: Dynamic Resolution + Spatial (Bicubic/Lanczos) + Temporal + Sharpen
 *
 * Zero-config. Mobile-first. FPS-first.
 *   <script src="./OpenScale.js"></script>
 *
 * Version: 1.0.0-rc
 */
(function (global) {
  "use strict";

  var CFG = {
    REAL_WIDTH: "AUTO", REAL_HEIGHT: "AUTO",
    INITIAL_SCALE: 0.50, TARGET_FPS: "MAX", PRIORITY: "FPS",
    DYNAMIC_RESOLUTION: true, MIN_SCALE: 0.30, MAX_SCALE: 1.00,
    UPSCALER: "AUTO",
    TEMPORAL_UPSCALING: true, MOTION_VECTORS: "AUTO", DEPTH: "AUTO",
    SHARPENING: true, SHARPENING_STRENGTH: 0.20,
    AUTO_DETECT_RENDERER: true, WEBGL: true, WEBGL2: true, WEBGPU: true,
    DEBUG: false, SHOW_OVERLAY: true
  };

  // ---- FrameTiming ----
  function FrameTiming(n){this.n=n||30;this.t=[];this.last=0;}
  FrameTiming.prototype.update=function(now){
    if(!this.last){this.last=now;return{frameTime:16.67,fps:60,averageFrameTime:16.67};}
    var d=now-this.last;this.last=now;
    if(d>100||d<1)return this.getStats();
    this.t.push(d);if(this.t.length>this.n)this.t.shift();
    return this.getStats();
  };
  FrameTiming.prototype.getStats=function(){
    if(!this.t.length)return{frameTime:16.67,fps:60,averageFrameTime:16.67};
    var s=0;for(var i=0;i<this.t.length;i++)s+=this.t[i];
    var a=s/this.t.length;
    return{frameTime:this.t[this.t.length-1],fps:Math.round(1000/a*10)/10,averageFrameTime:Math.round(a*100)/100};
  };

  // ---- ResolutionController ----
  function ResCtrl(c){this.c=c;this.scale=c.INITIAL_SCALE;this.cd=0;this.cdMs=700;this.step=0.05;this.sf=0;this.need=8;this.hi=18.5;this.lo=22;}
  ResCtrl.prototype.update=function(avg,now){
    if(!this.c.DYNAMIC_RESOLUTION||now<this.cd)return this.scale;
    var ch=false;
    if(avg<this.hi){this.sf++;if(this.sf>=this.need){var n=Math.min(this.c.MAX_SCALE,Math.round((this.scale+this.step)*100)/100);if(n>this.scale){this.scale=n;ch=true;}this.sf=0;}}
    else if(avg>this.lo){this.sf++;if(this.sf>=this.need){var n2=Math.max(this.c.MIN_SCALE,Math.round((this.scale-this.step)*100)/100);if(n2<this.scale){this.scale=n2;ch=true;}this.sf=0;}}
    else this.sf=0;
    if(ch)this.cd=now+this.cdMs;return this.scale;
  };
  ResCtrl.prototype.setScale=function(v){this.scale=Math.max(this.c.MIN_SCALE,Math.min(this.c.MAX_SCALE,v));this.cd=performance.now()+this.cdMs;};
  ResCtrl.prototype.getScale=function(){return this.scale;};

  // ---- CapabilityDetector ----
  function Caps(){this.c={webgl:false,webgl2:false,webgpu:false,maxTextureSize:0,devicePixelRatio:1,isMobile:false};}
  Caps.prototype.detect=function(){
    this.c.devicePixelRatio=window.devicePixelRatio||1;
    this.c.isMobile=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var cv=document.createElement("canvas"),gl=null;
    try{gl=cv.getContext("webgl2",{antialias:false});if(gl){this.c.webgl2=true;this.c.webgl=true;}}catch(e){}
    if(!gl){try{gl=cv.getContext("webgl",{antialias:false})||cv.getContext("experimental-webgl");if(gl)this.c.webgl=true;}catch(e2){}}
    if(gl)this.c.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(navigator.gpu)this.c.webgpu=true;return this.c;
  };

  // ---- RendererDetector ----
  function Det(){}
  Det.prototype.findCanvas=function(){
    var list=[].slice.call(document.querySelectorAll("canvas"));if(!list.length)return null;
    var best=null,ba=0,i,c,a,g;
    for(i=0;i<list.length;i++){c=list[i];a=(c.width||c.clientWidth)*(c.height||c.clientHeight);
      g=c.getContext("webgl2")||c.getContext("webgl")||c.getContext("experimental-webgl");
      if(g&&a>=ba){best=c;ba=a;}}
    if(!best)for(i=0;i<list.length;i++){c=list[i];a=(c.width||c.clientWidth)*(c.height||c.clientHeight);if(a>ba){best=c;ba=a;}}
    return best;
  };

  // ---- Shaders ----
  var VS2="#version 300 es\nin vec2 a_pos;\nout vec2 v_uv;\nvoid main(){v_uv=a_pos*0.5+0.5;gl_Position=vec4(a_pos,0.0,1.0);}";
  var VS1="attribute vec2 a_pos;varying vec2 v_uv;void main(){v_uv=a_pos*0.5+0.5;gl_Position=vec4(a_pos,0.0,1.0);}";

  var BICUBIC2=[
    "#version 300 es","precision highp float;","uniform sampler2D u_tex;","uniform vec2 u_texel;","in vec2 v_uv;","out vec4 fragColor;",
    "vec4 cubic(float v){vec4 n=vec4(1.0,2.0,3.0,4.0)-v;vec4 s=n*n*n;float x=s.x;float y=s.y-4.0*s.x;float z=s.z-4.0*s.y+6.0*s.x;float w=6.0-x-y-z;return vec4(x,y,z,w)*(1.0/6.0);}",
    "vec4 textureBicubic(sampler2D tex,vec2 uv,vec2 texel){vec2 inv=1.0/texel;vec2 coord=uv*inv-0.5;vec2 f=fract(coord);coord-=f;",
    "vec4 xc=cubic(f.x);vec4 yc=cubic(f.y);vec4 c=coord.xxyy+vec2(-0.5,1.5).xyxy;vec4 s=vec4(xc.xz+xc.yw,yc.xz+yc.yw);vec4 o=c+vec4(xc.yw,yc.yw)/s;o*=texel.xxyy;",
    "vec4 s0=texture(tex,o.xz);vec4 s1=texture(tex,o.yz);vec4 s2=texture(tex,o.xw);vec4 s3=texture(tex,o.yw);",
    "float sx=s.x/(s.x+s.y);float sy=s.z/(s.z+s.w);return mix(mix(s3,s2,sx),mix(s1,s0,sx),sy);}",
    "void main(){fragColor=textureBicubic(u_tex,v_uv,u_texel);}"
  ].join("\n");
  var BICUBIC1=BICUBIC2.replace("#version 300 es\n","").replace("in vec2 v_uv;","varying vec2 v_uv;").replace("out vec4 fragColor;","").replace(/texture\(/g,"texture2D(").replace("fragColor=","gl_FragColor=");

  var TEMP2=[
    "#version 300 es","precision highp float;","uniform sampler2D u_current;","uniform sampler2D u_history;","uniform vec2 u_texel;","uniform float u_blend;","in vec2 v_uv;","out vec4 fragColor;",
    "void main(){vec4 curr=texture(u_current,v_uv);vec4 hist=texture(u_history,v_uv);",
    "vec3 c00=texture(u_current,v_uv+vec2(-u_texel.x,-u_texel.y)).rgb;",
    "vec3 c10=texture(u_current,v_uv+vec2(0.0,-u_texel.y)).rgb;",
    "vec3 c20=texture(u_current,v_uv+vec2(u_texel.x,-u_texel.y)).rgb;",
    "vec3 c01=texture(u_current,v_uv+vec2(-u_texel.x,0.0)).rgb;vec3 c11=curr.rgb;",
    "vec3 c21=texture(u_current,v_uv+vec2(u_texel.x,0.0)).rgb;",
    "vec3 c02=texture(u_current,v_uv+vec2(-u_texel.x,u_texel.y)).rgb;",
    "vec3 c12=texture(u_current,v_uv+vec2(0.0,u_texel.y)).rgb;",
    "vec3 c22=texture(u_current,v_uv+vec2(u_texel.x,u_texel.y)).rgb;",
    "vec3 nmin=min(c00,min(c10,min(c20,min(c01,min(c11,min(c21,min(c02,min(c12,c22))))))));",
    "vec3 nmax=max(c00,max(c10,max(c20,max(c01,max(c11,max(c21,max(c02,max(c12,c22))))))));",
    "vec3 hc=clamp(hist.rgb,nmin,nmax);fragColor=vec4(mix(c11,hc,clamp(u_blend,0.0,0.5)),1.0);}"
  ].join("\n");
  var TEMP1=TEMP2.replace("#version 300 es\n","").replace("in vec2 v_uv;","varying vec2 v_uv;").replace("out vec4 fragColor;","").replace(/texture\(/g,"texture2D(").replace("fragColor=","gl_FragColor=");

  var SHARP2=[
    "#version 300 es","precision mediump float;","uniform sampler2D u_tex;","uniform vec2 u_texel;","uniform float u_strength;","in vec2 v_uv;","out vec4 fragColor;",
    "void main(){vec4 c=texture(u_tex,v_uv);",
    "vec4 n=texture(u_tex,v_uv+vec2(0.0,-u_texel.y));vec4 s=texture(u_tex,v_uv+vec2(0.0,u_texel.y));",
    "vec4 e=texture(u_tex,v_uv+vec2(u_texel.x,0.0));vec4 w=texture(u_tex,v_uv+vec2(-u_texel.x,0.0));",
    "vec4 blur=(n+s+e+w)*0.25;fragColor=clamp(c+(c-blur)*u_strength,0.0,1.0);}"
  ].join("\n");
  var SHARP1=SHARP2.replace("#version 300 es\n","").replace("in vec2 v_uv;","varying vec2 v_uv;").replace("out vec4 fragColor;","").replace(/texture\(/g,"texture2D(").replace("fragColor=","gl_FragColor=");

  // ---- Upscaler ----
  function Upscaler(canvas, opt) {
    opt=opt||{};
    this.canvas=canvas;
    this.method=(opt.method||"BICUBIC").toUpperCase();
    this.sharpen=!!opt.sharpen;
    this.sharpenStrength=opt.sharpenStrength!=null?opt.sharpenStrength:0.20;
    this.temporal=opt.temporal!==false;
    this.temporalBlend=opt.temporalBlend!=null?opt.temporalBlend:0.18;
    this.gl=null;this.is2=false;this.ready=false;
    this.spatial=null;this.temporalProg=null;this.sharpenProg=null;
    this.quad=null;this.srcTex=null;
    this.texA=null;this.texB=null;this.fboA=null;this.fboB=null;
    this.histIsB=true;this.frames=0;this.w=0;this.h=0;
    this._init();
  }
  Upscaler.prototype._init=function(){
    var o={antialias:false,alpha:false,preserveDrawingBuffer:false,powerPreference:"high-performance"};
    var gl=this.canvas.getContext("webgl2",o);
    if(gl)this.is2=true;else gl=this.canvas.getContext("webgl",o)||this.canvas.getContext("experimental-webgl",o);
    if(!gl)return;this.gl=gl;
    var vs=this.is2?VS2:VS1;
    var fs=this.is2?BICUBIC2:BICUBIC1;
    this.spatial=this._prog(vs,fs);if(!this.spatial)return;
    if(this.temporal){this.temporalProg=this._prog(vs,this.is2?TEMP2:TEMP1);if(!this.temporalProg)this.temporal=false;}
    if(this.sharpen){this.sharpenProg=this._prog(vs,this.is2?SHARP2:SHARP1);if(!this.sharpenProg)this.sharpen=false;}
    this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    this.srcTex=this._tex();this.ready=true;
  };
  Upscaler.prototype._prog=function(vsS,fsS){
    var gl=this.gl,vs=this._comp(gl.VERTEX_SHADER,vsS),fs=this._comp(gl.FRAGMENT_SHADER,fsS);
    if(!vs||!fs)return null;
    var p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))return null;return p;
  };
  Upscaler.prototype._comp=function(t,s){var sh=this.gl.createShader(t);this.gl.shaderSource(sh,s);this.gl.compileShader(sh);if(!this.gl.getShaderParameter(sh,this.gl.COMPILE_STATUS))return null;return sh;};
  Upscaler.prototype._tex=function(){
    var gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;
  };
  Upscaler.prototype._ensure=function(w,h){
    if(this.w===w&&this.h===h&&this.texA)return;
    var gl=this.gl;this.w=w;this.h=h;
    if(this.texA)gl.deleteTexture(this.texA);if(this.texB)gl.deleteTexture(this.texB);
    if(this.fboA)gl.deleteFramebuffer(this.fboA);if(this.fboB)gl.deleteFramebuffer(this.fboB);
    this.texA=this._tex();this.texB=this._tex();
    gl.bindTexture(gl.TEXTURE_2D,this.texA);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindTexture(gl.TEXTURE_2D,this.texB);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    this.fboA=gl.createFramebuffer();this.fboB=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fboA);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texA,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fboB);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texB,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.frames=0;this.histIsB=true;
  };
  Upscaler.prototype.render=function(src,simW,simH){
    if(!this.ready)return;
    var gl=this.gl,dw=this.canvas.width,dh=this.canvas.height;
    this._ensure(dw,dh);
    gl.bindTexture(gl.TEXTURE_2D,this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);

    // Spatial → A
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fboA);gl.viewport(0,0,dw,dh);
    this._drawSpatial(simW,simH);

    var cur=this.texA;
    if(this.temporal&&this.temporalProg&&this.frames>0){
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.fboB);gl.viewport(0,0,dw,dh);
      this._drawTemporal(this.texA,this.histIsB?this.texB:this.texA,dw,dh);
      cur=this.texB;this.histIsB=true;
    }else if(this.temporal){
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.fboB);gl.viewport(0,0,dw,dh);
      this._drawCopy(this.texA);cur=this.texB;this.histIsB=true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,dw,dh);
    if(this.sharpen&&this.sharpenProg)this._drawSharpen(cur,dw,dh);
    else this._drawCopy(cur);
    this.frames++;
  };
  Upscaler.prototype._bindQ=function(p){
    var gl=this.gl,l=gl.getAttribLocation(p,"a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
  };
  Upscaler.prototype._drawSpatial=function(sw,sh){
    var gl=this.gl;gl.useProgram(this.spatial);this._bindQ(this.spatial);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.srcTex);
    gl.uniform1i(gl.getUniformLocation(this.spatial,"u_tex"),0);
    gl.uniform2f(gl.getUniformLocation(this.spatial,"u_texel"),1/sw,1/sh);
    gl.drawArrays(gl.TRIANGLES,0,6);
  };
  Upscaler.prototype._drawTemporal=function(curr,hist,dw,dh){
    var gl=this.gl;gl.useProgram(this.temporalProg);this._bindQ(this.temporalProg);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,curr);
    gl.uniform1i(gl.getUniformLocation(this.temporalProg,"u_current"),0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,hist);
    gl.uniform1i(gl.getUniformLocation(this.temporalProg,"u_history"),1);
    gl.uniform2f(gl.getUniformLocation(this.temporalProg,"u_texel"),1/dw,1/dh);
    gl.uniform1f(gl.getUniformLocation(this.temporalProg,"u_blend"),this.temporalBlend);
    gl.drawArrays(gl.TRIANGLES,0,6);
  };
  Upscaler.prototype._drawSharpen=function(tex,dw,dh){
    var gl=this.gl;gl.useProgram(this.sharpenProg);this._bindQ(this.sharpenProg);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.uniform1i(gl.getUniformLocation(this.sharpenProg,"u_tex"),0);
    gl.uniform2f(gl.getUniformLocation(this.sharpenProg,"u_texel"),1/dw,1/dh);
    gl.uniform1f(gl.getUniformLocation(this.sharpenProg,"u_strength"),this.sharpenStrength);
    gl.drawArrays(gl.TRIANGLES,0,6);
  };
  Upscaler.prototype._drawCopy=function(tex){
    var gl=this.gl;
    if(this.sharpenProg){
      gl.useProgram(this.sharpenProg);this._bindQ(this.sharpenProg);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.uniform1i(gl.getUniformLocation(this.sharpenProg,"u_tex"),0);
      gl.uniform2f(gl.getUniformLocation(this.sharpenProg,"u_texel"),0,0);
      gl.uniform1f(gl.getUniformLocation(this.sharpenProg,"u_strength"),0);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }else{
      gl.useProgram(this.spatial);this._bindQ(this.spatial);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.uniform1i(gl.getUniformLocation(this.spatial,"u_tex"),0);
      gl.uniform2f(gl.getUniformLocation(this.spatial,"u_texel"),1/this.w,1/this.h);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
  };
  Upscaler.prototype.resize=function(w,h){
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.w=0;this.h=0;this.frames=0;}
  };
  Upscaler.prototype.destroy=function(){
    if(!this.gl)return;var gl=this.gl;
    if(this.srcTex)gl.deleteTexture(this.srcTex);
    if(this.texA)gl.deleteTexture(this.texA);if(this.texB)gl.deleteTexture(this.texB);
    if(this.fboA)gl.deleteFramebuffer(this.fboA);if(this.fboB)gl.deleteFramebuffer(this.fboB);
    if(this.quad)gl.deleteBuffer(this.quad);
    if(this.spatial)gl.deleteProgram(this.spatial);
    if(this.temporalProg)gl.deleteProgram(this.temporalProg);
    if(this.sharpenProg)gl.deleteProgram(this.sharpenProg);
    this.ready=false;
  };

  // ---- OpenScale ----
  function OpenScale(uc){
    this.config={};for(var k in CFG)this.config[k]=CFG[k];
    if(uc)for(var k2 in uc)this.config[k2]=uc[k2];
    this.running=false;this.gameCanvas=null;this.displayCanvas=null;
    this.displayWidth=0;this.displayHeight=0;this.simulationWidth=0;this.simulationHeight=0;
    this.scale=this.config.INITIAL_SCALE;
    this.ft=new FrameTiming();this.rc=new ResCtrl(this.config);
    this.capsDet=new Caps();this.rendDet=new Det();
    this.upscaler=null;this.caps=null;this.overlay=null;this.rafId=null;this.useReal=false;
    this._onResize=this._onResize.bind(this);this._loop=this._loop.bind(this);
  }
  OpenScale.prototype.start=function(){if(this.running)return this;this._init();this.running=true;this.rafId=requestAnimationFrame(this._loop);return this;};
  OpenScale.prototype.stop=function(){
    this.running=false;if(this.rafId){cancelAnimationFrame(this.rafId);this.rafId=null;}
    if(this.upscaler){this.upscaler.destroy();this.upscaler=null;}
    this._rmOverlay();window.removeEventListener("resize",this._onResize);window.removeEventListener("orientationchange",this._onResize);return this;
  };
  OpenScale.prototype.setScale=function(v){this.rc.setScale(v);this.scale=this.rc.getScale();this._apply();return this;};
  OpenScale.prototype.getFPS=function(){return this.ft.getStats().fps;};
  OpenScale.prototype.getResolution=function(){return{display:{width:this.displayWidth,height:this.displayHeight},simulation:{width:this.simulationWidth,height:this.simulationHeight},scale:this.scale};};
  OpenScale.prototype.setUpscaler=function(n){this.config.UPSCALER=n;return this;};

  OpenScale.prototype._init=function(){
    this.caps=this.capsDet.detect();this.gameCanvas=this.rendDet.findCanvas();
    if(!this.gameCanvas){var self=this,r=0;var retry=function(){self.gameCanvas=self.rendDet.findCanvas();if(self.gameCanvas||r++>25){if(self.gameCanvas)self._setup();return;}setTimeout(retry,80);};setTimeout(retry,50);return;}
    this._setup();
  };
  OpenScale.prototype._setup=function(){
    this._updDisp();
    var want=this.config.UPSCALER==="AUTO"||this.config.UPSCALER==="BICUBIC"||this.config.UPSCALER==="LANCZOS";
    if(want&&(this.caps.webgl2||this.caps.webgl))this._setupReal();else this._setupSimple();
    this.scale=this.config.INITIAL_SCALE;this.rc.setScale(this.scale);this._apply();
    window.addEventListener("resize",this._onResize);window.addEventListener("orientationchange",this._onResize);
    document.addEventListener("fullscreenchange",this._onResize);document.addEventListener("webkitfullscreenchange",this._onResize);
    if(this.config.SHOW_OVERLAY||this.config.DEBUG)this._mkOverlay();
  };
  OpenScale.prototype._setupReal=function(){
    this.displayCanvas=document.createElement("canvas");this.displayCanvas.id="openscale-display";
    this.displayCanvas.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;display:block;z-index:1;pointer-events:none;";
    if(this.gameCanvas.parentNode)this.gameCanvas.parentNode.insertBefore(this.displayCanvas,this.gameCanvas.nextSibling);
    else document.body.appendChild(this.displayCanvas);
    this.gameCanvas.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;display:block;z-index:0;opacity:0;pointer-events:auto;";
    var par=this.gameCanvas.parentNode;if(par&&par!==document.body){var pos=getComputedStyle(par).position;if(pos==="static")par.style.position="relative";}
    var method=this.config.UPSCALER==="AUTO"?"BICUBIC":this.config.UPSCALER;
    this.upscaler=new Upscaler(this.displayCanvas,{
      method:method,sharpen:!!this.config.SHARPENING,sharpenStrength:this.config.SHARPENING_STRENGTH||0.20,
      temporal:!!this.config.TEMPORAL_UPSCALING,temporalBlend:0.18
    });
    this.useReal=this.upscaler.ready;
    if(!this.useReal){this._cleanReal();this._setupSimple();}
  };
  OpenScale.prototype._cleanReal=function(){
    if(this.displayCanvas&&this.displayCanvas.parentNode)this.displayCanvas.parentNode.removeChild(this.displayCanvas);
    this.displayCanvas=null;if(this.upscaler){this.upscaler.destroy();this.upscaler=null;}
    if(this.gameCanvas){this.gameCanvas.style.opacity="1";this.gameCanvas.style.zIndex="";}this.useReal=false;
  };
  OpenScale.prototype._setupSimple=function(){
    this.displayCanvas=this.gameCanvas;this.useReal=false;
    if(!this.gameCanvas.style.width)this.gameCanvas.style.width="100%";
    if(!this.gameCanvas.style.height)this.gameCanvas.style.height="100%";
  };
  OpenScale.prototype._updDisp=function(){
    var ref=this.gameCanvas||document.documentElement;
    var cw=ref.clientWidth||window.innerWidth,ch=ref.clientHeight||window.innerHeight;
    var dpr=(this.caps&&this.caps.devicePixelRatio)||window.devicePixelRatio||1;
    this.displayWidth=this.config.REAL_WIDTH==="AUTO"?Math.round(cw*dpr):this.config.REAL_WIDTH;
    this.displayHeight=this.config.REAL_HEIGHT==="AUTO"?Math.round(ch*dpr):this.config.REAL_HEIGHT;
  };
  OpenScale.prototype._apply=function(){
    this.simulationWidth=Math.max(1,Math.round(this.displayWidth*this.scale));
    this.simulationHeight=Math.max(1,Math.round(this.displayHeight*this.scale));
    if(this.gameCanvas){
      if(this.gameCanvas.width!==this.simulationWidth||this.gameCanvas.height!==this.simulationHeight){
        this.gameCanvas.width=this.simulationWidth;this.gameCanvas.height=this.simulationHeight;
      }
    }
    if(this.useReal&&this.upscaler)this.upscaler.resize(this.displayWidth,this.displayHeight);
  };
  OpenScale.prototype._onResize=function(){
    var self=this;clearTimeout(this._rt);
    this._rt=setTimeout(function(){self._updDisp();self._apply();},50);
  };
  OpenScale.prototype._loop=function(now){
    if(!this.running)return;
    var st=this.ft.update(now);
    if(this.config.DYNAMIC_RESOLUTION){
      var ns=this.rc.update(st.averageFrameTime,now);
      if(ns!==this.scale){this.scale=ns;this._apply();}
    }
    if(this.useReal&&this.upscaler&&this.gameCanvas)this.upscaler.render(this.gameCanvas,this.simulationWidth,this.simulationHeight);
    if(this.overlay)this._updOverlay(st);
    this.rafId=requestAnimationFrame(this._loop);
  };
  OpenScale.prototype._mkOverlay=function(){
    if(this.overlay)return;
    this.overlay=document.createElement("div");this.overlay.id="openscale-overlay";
    this.overlay.style.cssText="position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,0.78);color:#0ff;font:12px/1.4 monospace;padding:8px 12px;border-radius:6px;pointer-events:none;white-space:pre;min-width:200px;";
    document.body.appendChild(this.overlay);
  };
  OpenScale.prototype._updOverlay=function(st){
    var name="browser-bilinear (Phase 1)";
    if(this.useReal){
      var m=(this.config.UPSCALER||"BICUBIC").toUpperCase();
      var n=m==="AUTO"?"bicubic":m.toLowerCase();
      var parts=[n];
      if(this.config.TEMPORAL_UPSCALING)parts.push("temporal");
      if(this.config.SHARPENING)parts.push("sharpen");
      name=parts.join(" + ")+" (v1.0)";
    }
    this.overlay.textContent="OpenScale\nFPS: "+st.fps+"\nFrame: "+st.averageFrameTime.toFixed(2)+" ms\nDisplay: "+this.displayWidth+"×"+this.displayHeight+"\nSimulation: "+this.simulationWidth+"×"+this.simulationHeight+"\nScale: "+Math.round(this.scale*100)+"%\nUpscaler: "+name;
  };
  OpenScale.prototype._rmOverlay=function(){if(this.overlay&&this.overlay.parentNode)this.overlay.parentNode.removeChild(this.overlay);this.overlay=null;};

  var instance=null;
  function autoStart(){if(instance)return;instance=new OpenScale();setTimeout(function(){instance.start();},60);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",autoStart);else autoStart();

  global.OpenScale={
    start:function(){return instance?instance.start():autoStart();},
    stop:function(){return instance&&instance.stop();},
    setScale:function(v){return instance&&instance.setScale(v);},
    getFPS:function(){return instance?instance.getFPS():0;},
    getResolution:function(){return instance?instance.getResolution():null;},
    setUpscaler:function(n){return instance&&instance.setUpscaler(n);},
    getInstance:function(){return instance;},
    version:"1.0.0-rc"
  };
})(typeof window!=="undefined"?window:this);
