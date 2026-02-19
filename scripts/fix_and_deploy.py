
import pty
import os
import time
import select

HOST = "root@139.59.102.74"
PASSWORD = "Pan@1991@One"

def run_ssh(command, timeout=30):
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
    # 1. Fix rate limits in .env
    run_ssh(
        "cd /opt/one-ui/backend && "
        "sed -i 's/^RATE_LIMIT_MAX_REQUESTS=.*/RATE_LIMIT_MAX_REQUESTS=1000000/' .env && "
        "sed -i 's/^AUTH_RATE_LIMIT_MAX=.*/AUTH_RATE_LIMIT_MAX=1000000/' .env && "
        "echo 'RATE_LIMITS_FIXED'"
    )
    
    # 2. Pull latest code
    run_ssh(
        "cd /opt/one-ui && git fetch --all && git reset --hard origin/main && echo 'CODE_UPDATED'",
        timeout=30
    )
    
    # 3. Rebuild and restart backend
    run_ssh(
        "cd /opt/one-ui && docker compose up -d --build backend && echo 'BACKEND_RESTARTED'",
        timeout=120
    )
    
    print("\n\nDEPLOYMENT COMPLETE")
