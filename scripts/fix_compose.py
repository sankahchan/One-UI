
import pty
import os
import time
import select

HOST = "root@139.59.102.74"
PASSWORD = "Pan@1991@One"

def run_ssh(command, timeout=60):
    print(f"\n{'='*60}")
    print(f"CMD: {command}")
    print('='*60)
    
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("ssh", ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", HOST, command])
    
    time.sleep(2)
    try:
        initial = os.read(fd, 4096).decode(errors='replace')
        print(f"[INIT]: {initial.strip()}")
    except:
        pass
    
    os.write(fd, (PASSWORD + "\n").encode())
    time.sleep(1)
    
    output = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r, _, _ = select.select([fd], [], [], 1)
            if r:
                data = os.read(fd, 4096).decode(errors='replace')
                if not data:
                    break
                output.append(data)
                print(data, end="")
            else:
                try:
                    wpid, status = os.waitpid(pid, os.WNOHANG)
                    if wpid != 0:
                        break
                except:
                    break
        except OSError:
            break
    
    try:
        os.waitpid(pid, os.WNOHANG)
    except:
        pass
    
    return "".join(output)

if __name__ == "__main__":
    # Use python to fix the YAML properly - remove the empty volumes key from backend service
    fix_cmd = """python3 -c "
import re
with open('/opt/one-ui/docker-compose.yml', 'r') as f:
    content = f.read()
# Remove the standalone 'volumes:' line under backend (the one with no entries after it)
# It's followed immediately by '    command:'
content = content.replace('    volumes:\\n    command:', '    command:')
with open('/opt/one-ui/docker-compose.yml', 'w') as f:
    f.write(content)
print('YAML_FIXED')
" """
    run_ssh(fix_cmd)

    # Verify
    run_ssh("cd /opt/one-ui && docker compose config --quiet && echo 'COMPOSE_VALID'")
    
    # Restart backend
    run_ssh("cd /opt/one-ui && docker compose up -d backend && echo 'BACKEND_RESTARTED'", timeout=60)
    
    print("\n\nFIX COMPLETE")
