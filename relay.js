/* Kênh kết nối qua máy chủ trung gian (MQTT công cộng trên WebSocket bảo mật).
   Tin nhắn đi qua máy chủ nên không bị chặn bởi 4G/NAT như kết nối trực tiếp P2P.
   Tự viết gọn (không cần tải thư viện ngoài). */
(function(){
  const BROKERS=[
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://mqtt.eclipseprojects.io/mqtt",
    "wss://test.mosquitto.org:8081/mqtt"
  ];
  const te=new TextEncoder(),td=new TextDecoder();
  function cat(parts){let n=0;parts.forEach(p=>n+=p.length);const a=new Uint8Array(n);let o=0;parts.forEach(p=>{a.set(p,o);o+=p.length});return a}
  function str(s){const b=te.encode(s);return cat([new Uint8Array([b.length>>8,b.length&255]),b])}
  function pkt(type,body){const len=[];let n=body.length;do{let d=n%128;n=Math.floor(n/128);if(n>0)d|=128;len.push(d)}while(n>0);return cat([new Uint8Array([type]),new Uint8Array(len),body])}

  function Relay(url){this.url=url;this.ok=false;this.onmsg=null;this.onclose=null;this.buf=new Uint8Array(0);this.mid=1;this.ws=null;this.ka=null;this._fin=null}
  Relay.prototype.connect=function(timeout){
    return new Promise((res,rej)=>{
      let done=false;
      const fin=(ok,why)=>{if(done)return;done=true;clearTimeout(t);if(ok)res(this);else{this.close();rej(why)}};
      this._fin=fin;
      const t=setTimeout(()=>fin(false,"timeout"),timeout||7000);
      let ws;
      try{ws=new WebSocket(this.url,"mqtt")}catch(e){return fin(false,"ws")}
      this.ws=ws;ws.binaryType="arraybuffer";
      ws.onopen=()=>{
        const id="pbc"+Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-6);
        ws.send(pkt(0x10,cat([str("MQTT"),new Uint8Array([4,2,0,60]),str(id)])));
      };
      ws.onmessage=e=>{try{this._data(new Uint8Array(e.data))}catch(err){}};
      ws.onerror=()=>fin(false,"error");
      ws.onclose=()=>{const was=this.ok;this.ok=false;clearInterval(this.ka);fin(false,"closed");if(was&&this.onclose){const f=this.onclose;this.onclose=null;f()}};
    });
  };
  Relay.prototype._data=function(chunk){
    this.buf=this.buf.length?cat([this.buf,chunk]):chunk;
    for(;;){
      const b=this.buf;if(b.length<2)return;
      let len=0,mul=1,i=1,d;
      do{if(i>=b.length)return;d=b[i++];len+=(d&127)*mul;mul*=128}while(d&128);
      if(b.length<i+len)return;
      const type=b[0],body=b.subarray(i,i+len);this.buf=b.subarray(i+len);
      const kind=type>>4;
      if(kind===2){ // CONNACK
        if(body[1]===0){this.ok=true;clearInterval(this.ka);this.ka=setInterval(()=>{try{this.ws.send(new Uint8Array([0xC0,0]))}catch(e){}},20000);this._fin&&this._fin(true)}
        else this._fin&&this._fin(false,"refused");
      }else if(kind===3){ // PUBLISH
        const qos=(type>>1)&3,tl=(body[0]<<8)|body[1];
        const topic=td.decode(body.subarray(2,2+tl));let off=2+tl;
        if(qos>0){const id=[body[off],body[off+1]];off+=2;if(qos===1)try{this.ws.send(new Uint8Array([0x40,2,id[0],id[1]]))}catch(e){}}
        let o=null;try{o=JSON.parse(td.decode(body.subarray(off)))}catch(e){}
        if(o&&this.onmsg)this.onmsg(topic,o);
      }
    }
  };
  Relay.prototype.sub=function(topic){
    if(!this.ok)return;const id=this.mid++&0xffff||1;
    this.ws.send(pkt(0x82,cat([new Uint8Array([id>>8,id&255]),str(topic),new Uint8Array([0])])));
  };
  Relay.prototype.pub=function(topic,obj){
    if(!this.ok)return false;
    try{this.ws.send(pkt(0x30,cat([str(topic),te.encode(JSON.stringify(obj))])));return true}catch(e){return false}
  };
  Relay.prototype.close=function(){
    this.onclose=null;const ws=this.ws;this.ok=false;clearInterval(this.ka);
    if(ws){try{if(ws.readyState===1)ws.send(new Uint8Array([0xE0,0]))}catch(e){}try{ws.close()}catch(e){}}
  };
  window.QuizRelay={BROKERS,Relay,topic:(prefix,pin)=>"pbcqz/v1/"+prefix+pin};
})();
