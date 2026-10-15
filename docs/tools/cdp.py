"""Tiny Chrome DevTools client (stdlib only) for taking app screenshots."""
import socket, base64, os, json, struct, urllib.request, time, sys
class WS:
    def __init__(self, url):
        rest=url.split('://',1)[1]; hostport,path=rest.split('/',1); host,port=hostport.split(':')
        self.s=socket.create_connection((host,int(port))); key=base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf=b''
        while b'\r\n\r\n' not in buf: buf+=self.s.recv(4096)
        self.buf=buf.split(b'\r\n\r\n',1)[1]; self.id=0
    def _read(self,n):
        while len(self.buf)<n:
            chunk=self.s.recv(1<<20)
            if not chunk: raise EOFError
            self.buf+=chunk
        out,self.buf=self.buf[:n],self.buf[n:]; return out
    def send(self,obj):
        data=json.dumps(obj).encode(); hdr=bytearray([0x81]); n=len(data)
        if n<126: hdr.append(0x80|n)
        elif n<65536: hdr.append(0x80|126); hdr+=struct.pack('>H',n)
        else: hdr.append(0x80|127); hdr+=struct.pack('>Q',n)
        mask=os.urandom(4); hdr+=mask
        self.s.sendall(bytes(hdr)+bytes(b^mask[i%4] for i,b in enumerate(data)))
    def recv(self):
        msg=b''
        while True:
            b1,b2=self._read(2); n=b2&0x7f
            if n==126: n=struct.unpack('>H',self._read(2))[0]
            elif n==127: n=struct.unpack('>Q',self._read(8))[0]
            payload=self._read(n); op=b1&0x0f
            if op in (0,1,2): msg+=payload
            if b1&0x80 and op in (0,1,2): return json.loads(msg)
    def call(self,method,params=None):
        self.id+=1; i=self.id; self.send({'id':i,'method':method,'params':params or {}})
        while True:
            m=self.recv()
            if m.get('id')==i:
                if 'error' in m: raise RuntimeError(f"{method}: {m['error']}")
                return m.get('result',{})
def page(port):
    for _ in range(50):
        try:
            tabs=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
            p=[t for t in tabs if t.get('type')=='page']
            if p: return WS(p[0]['webSocketDebuggerUrl'])
        except Exception: pass
        time.sleep(0.2)
    raise SystemExit('no chrome')
def js(ws,code):
    r=ws.call('Runtime.evaluate',{'expression':code,'awaitPromise':True,'returnByValue':True})
    if r.get('exceptionDetails'): raise RuntimeError(json.dumps(r['exceptionDetails'])[:600])
    return r.get('result',{}).get('value')
def shot(ws,path,quality=88,h=None):
    params={'format':'jpeg','quality':quality}
    if h: params['clip']={'x':0,'y':0,'width':1200,'height':h,'scale':1}
    data=ws.call('Page.captureScreenshot',params)['data']
    open(path,'wb').write(base64.b64decode(data)); print('saved',path,os.path.getsize(path)//1024,'KB')
