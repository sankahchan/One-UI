
import pty
import os

commands = [
    'cd /opt/one-ui',
    'git checkout docker/Dockerfile.xray',
    'git pull',
    'docker compose up -d --build backend',
    'echo "UPDATE_SUCCESS"'
]

combined_command = " && ".join(commands)

pid, fd = pty.fork()

if pid == 0:
    os.execlp('ssh', 'ssh', '-o', 'StrictHostKeyChecking=no', 'root@139.59.102.74', combined_command)
else:
    output_buffer = b""
    password_sent = False
    
    while True:
        try:
            chunk = os.read(fd, 1024)
            if not chunk:
                break
            output_buffer += chunk
            text = output_buffer.decode('utf-8', errors='ignore')
            print(text, end='') 
            
            if "password:" in text and not password_sent:
                os.write(fd, b"Pan@1991@One\n")
                password_sent = True
        except OSError:
            break
            
    os.close(fd)
    os.waitpid(pid, 0)
