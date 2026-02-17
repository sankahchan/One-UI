
import pty
import os
import time
import subprocess

# SSH details
HOST = "root@139.59.102.74"
PASSWORD = "cherry-betray-behave"
# Command to update .env file
# We use sed to replace the value. We also append if not exists? sed won't append.
# But assuming it exists since we suspect it overrides.
CMD = "cd /opt/one-ui/backend && sed -i 's/^RATE_LIMIT_MAX_REQUESTS=.*/RATE_LIMIT_MAX_REQUESTS=10000/' .env && sed -i 's/^AUTH_RATE_LIMIT_MAX=.*/AUTH_RATE_LIMIT_MAX=1000/' .env && echo 'ENV_UPDATED'"

def run_ssh_command(host, password, command):
    print(f"Running command on {host}: {command}")
    pid, fd = pty.fork()
    if pid == 0:
        # Child process
        os.execvp("ssh", ["ssh", "-o", "StrictHostKeyChecking=no", host, command])
    else:
        # Parent process
        time.sleep(1)  # Wait for SSH to start
        os.write(fd, (password + "\n").encode())
        
        output = []
        while True:
            try:
                data = os.read(fd, 1024).decode()
                if not data:
                    break
                output.append(data)
                print(data, end="")
                if "ENV_UPDATED" in data:
                    break
            except OSError:
                break
        
        os.waitpid(pid, 0)
        return "".join(output)

if __name__ == "__main__":
    run_ssh_command(HOST, PASSWORD, CMD)
