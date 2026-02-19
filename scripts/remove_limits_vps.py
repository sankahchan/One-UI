
import pty
import os
import time
import subprocess

# SSH details
HOST = "root@139.59.102.74"
PASSWORD = "cherry-betray-behave"
# Command to remove lines containing RATE_LIMIT from .env
CMD = "cd /opt/one-ui/backend && sed -i '/RATE_LIMIT/d' .env && echo 'ENV_CLEANED'"

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
                if "ENV_CLEANED" in data:
                    break
            except OSError:
                break
        
        os.waitpid(pid, 0)
        return "".join(output)

if __name__ == "__main__":
    run_ssh_command(HOST, PASSWORD, CMD)
