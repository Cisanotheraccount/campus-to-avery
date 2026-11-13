#!/usr/bin/env python3
"""Serve only this review build and its monitor; never take over other ports."""
import pathlib, socket, subprocess, sys, time
root=pathlib.Path(__file__).resolve().parents[1]
if not (root/'dist/index.html').exists():
    sys.exit('Build missing. Run npm run build first.')
for port in (4184,8796):
    with socket.socket() as s:
        try:s.bind(('127.0.0.1',port))
        except OSError:sys.exit(f'Port {port} is occupied. Existing services were not changed.')
children=[]
try:
    children.append(subprocess.Popen([sys.executable,str(root/'scripts/resource-monitor.py')],cwd=root))
    children.append(subprocess.Popen([sys.executable,'-m','http.server','4184','--bind','127.0.0.1','--directory',str(root/'dist')],cwd=root))
    print('Review: http://127.0.0.1:4184/ — Ctrl-C stops these two processes only.',flush=True)
    while all(p.poll() is None for p in children):time.sleep(.5)
except KeyboardInterrupt:pass
finally:
    for p in children:
        if p.poll() is None:p.terminate()
    for p in children:
        try:p.wait(timeout=3)
        except subprocess.TimeoutExpired:p.kill()
