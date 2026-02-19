
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
    # Fix DATABASE_URL: change 127.0.0.1 to 'db' (Docker service name)
    run_ssh(
        "cd /opt/one-ui/backend && "
        "sed -i 's|postgresql://postgres:\\(.*\\)@127.0.0.1:5432|postgresql://postgres:\\1@db:5432|' .env && "
        "grep DATABASE_URL .env && "
        "echo 'DB_URL_FIXED'"
    )
    
    # Also fix XRAY_API_URL from 127.0.0.1 to xray container 
    # Actually xray uses network_mode: host, so 127.0.0.1 is correct for that
    
    # Restart backend
    run_ssh(
        "cd /opt/one-ui && docker compose up -d backend && echo 'BACKEND_RESTARTED'",
        timeout=60
    )
    
    # Wait a few seconds and check logs
    run_ssh("sleep 5 && docker logs --tail 10 one-ui-backend 2>&1")
    
    print("\n\nFIX COMPLETE")
