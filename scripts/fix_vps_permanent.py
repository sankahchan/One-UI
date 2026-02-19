
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
        os.read(fd, 4096)
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

OVERRIDE_CONTENT = """version: '3.8'
services:
  backend:
    ports:
      - "9290:9290"
    volumes: []
    command: npm start
"""

if __name__ == "__main__":
    # 1. Create docker-compose.override.yml (persists across git reset)
    run_ssh(
        f"cat > /opt/one-ui/docker-compose.override.yml << 'ENDOFFILE'\n{OVERRIDE_CONTENT}ENDOFFILE\n"
        "echo 'OVERRIDE_CREATED'"
    )

    # 2. Fix DATABASE_URL (127.0.0.1 -> db) 
    run_ssh(
        "cd /opt/one-ui/backend && "
        "sed -i 's|@127.0.0.1:5432|@db:5432|' .env && "
        "grep DATABASE_URL .env && "
        "echo 'DB_FIXED'"
    )

    # 3. Fix rate limits again (git reset may have restored old env.js defaults)
    run_ssh(
        "cd /opt/one-ui/backend && "
        "sed -i 's/^RATE_LIMIT_MAX_REQUESTS=.*/RATE_LIMIT_MAX_REQUESTS=1000000/' .env && "
        "sed -i 's/^AUTH_RATE_LIMIT_MAX=.*/AUTH_RATE_LIMIT_MAX=1000000/' .env && "
        "echo 'RATES_FIXED'"
    )

    # 4. Verify compose config is valid
    run_ssh("cd /opt/one-ui && docker compose config --quiet && echo 'CONFIG_VALID'")

    # 5. Rebuild and restart backend
    run_ssh("cd /opt/one-ui && docker compose up -d --build backend && echo 'DEPLOYED'", timeout=120)

    # 6. Check logs
    run_ssh("sleep 5 && docker logs --tail 5 one-ui-backend 2>&1", timeout=15)
    
    print("\n\nALL DONE")
