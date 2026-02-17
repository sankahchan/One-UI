
import pty
import os
import time
import subprocess

# SSH details
HOST = "root@139.59.102.74"
PASSWORD = "cherry-betray-behave"
CMD = "docker restart one-ui-backend && echo 'RESTART_SUCCESS'"

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
                if "RESTART_SUCCESS" in data:
                    break
            except OSError:
                break
        
        os.waitpid(pid, 0)
        return "".join(output)

if __name__ == "__main__":
    run_ssh_command(HOST, PASSWORD, CMD)
