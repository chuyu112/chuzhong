#!/usr/bin/env python3
"""Run scoped deployment commands over SSH without placing secrets in arguments."""
from pathlib import Path
import os
import sys
import threading
import paramiko

root = Path(__file__).resolve().parent.parent
config = {}
for line in (root.parent / '服务器部署.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        config[key.strip()] = value.strip()
client = paramiko.SSHClient()
client.load_system_host_keys()
client.load_host_keys(str(root / 'artifacts' / 'deploy-known-hosts'))
try:
    client.connect(config['SSH_HOST'], port=int(config.get('SSH_PORT') or 22),
                   username=config['SSH_USER'], password=config['SSH_PASSWORD'],
                   look_for_keys=False, allow_agent=False, timeout=20, auth_timeout=20)
    client.get_transport().set_keepalive(15)
    if sys.argv[1] == 'upload':
        local, remote = sys.argv[2:4]
        with client.open_sftp() as sftp:
            last = [-1]
            def progress(done, total):
                step = int(done * 10 / total)
                if step != last[0]:
                    print(f'Upload {step * 10}%', flush=True)
                    last[0] = step
            sftp.put(local, remote, callback=progress)
            sftp.chmod(remote, 0o600)
        print('Upload complete', flush=True)
    elif sys.argv[1] == 'download':
        remote, local = sys.argv[2:4]
        with client.open_sftp() as sftp:
            sftp.get(remote, local)
        os.chmod(local, 0o600)
        print('Download complete', flush=True)
    elif sys.argv[1] == 'exec':
        script = sys.stdin.read()
        stdin, stdout, stderr = client.exec_command('/bin/bash -se')
        stdin.write(script)
        stdin.channel.shutdown_write()
        def copy(stream, target):
            for line in stream:
                target.write(line)
                target.flush()
        errors = threading.Thread(target=copy, args=(stderr, sys.stderr))
        errors.start()
        copy(stdout, sys.stdout)
        errors.join()
        sys.exit(stdout.channel.recv_exit_status())
    else:
        raise ValueError('Use exec, upload or download')
finally:
    client.close()
