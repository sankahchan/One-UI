
import pty
import os
import time
import select

HOST = "root@139.59.102.74"
PASSWORD = "Pan@1991@One"

def run_ssh(command):
    print(f"\n{'='*60}")
    print(f"CMD: {command}")
    print('='*60)
    
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("ssh", ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", HOST, command])
    
    # Wait for password prompt
    time.sleep(2)
    
    # Read any initial output (banner, prompt)
    try:
        initial = os.read(fd, 4096).decode(errors='replace')
        print(f"[INIT]: {initial.strip()}")
    except:
        pass
    
    # Send password
    os.write(fd, (PASSWORD + "\n").encode())
    time.sleep(1)
    
    # Read output with timeout
    output = []
    deadline = time.time() + 15  # 15 second timeout
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
    # 1. Container status
    run_ssh("docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'")
    
    # 2. Backend .env
    run_ssh("cat /opt/one-ui/backend/.env")
    
    # 3. What's on port 9290
    run_ssh("ss -tlnp | grep -E '9290|3000'")
    
    # 4. Backend logs (last 15)
    run_ssh("docker logs --tail 15 one-ui-backend 2>&1")

    # 5. Xray config 
    run_ssh("cat /opt/one-ui/xray/config.json | head -30")
    
    print("\n\nDIAGNOSTIC COMPLETE")
