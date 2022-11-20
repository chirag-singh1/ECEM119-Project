import serial
import numpy as np
from threading import Thread
from scipy.fftpack import fft

BUFSIZE = 1000
FREQUENCY = 200.0

def find_border(t, n, dt, start_time):
    for i in range(len(t)):
        if n*dt + start_time <= t[i]:
            return i-1, i
    return len(t)-1, len(t)


def generate_interpolated_data(data, t):
    start_time = t[0]
    end_time = t[len(t)-1]
    dt = 1000.0 / FREQUENCY
    n = 1

    t = np.array([0.0])
    out = np.array([data[0]])
    while n*dt + start_time < end_time:
        prev, curr = find_border(t, n, dt, start_time)
        ct = start_time + n * dt
        if curr < BUFSIZE:
            t = np.append(t, [n*dt])
            out = np.append(out, [data[prev] * (1-((ct - t[prev]) / (t[curr] - t[prev]))
                                                ) + data[curr] * (1-((t[curr] - ct) / (t[curr] - t[prev])))])
            n += 1

    return out, t


class ProcessAuthenticationTask(Thread):
    def run(self):
        ser = serial.Serial('/dev/ttyACM0')
        ser.baudrate = 9600
        ax = np.zeros((BUFSIZE))
        ay = np.zeros((BUFSIZE))
        az = np.zeros((BUFSIZE))
        t = np.zeros((BUFSIZE))

        while True:
            for i in range(BUFSIZE):
                data_line = ser.readline().decode('utf-8').strip().split(',')
                if len(data_line) == 4:
                    ax[i] = float(data_line[0])
                    ay[i] = float(data_line[1])
                    az[i] = float(data_line[2])
                    t[i] = int(data_line[3])

            axint, tint = generate_interpolated_data(ax, t)
            ayint, tint = generate_interpolated_data(ax, t)
            azint, tint = generate_interpolated_data(ax, t)
            print(axint)


if __name__ == '__main__':
    # a = ReadDataTask()
    b = ProcessAuthenticationTask()
    # a.start()
    b.start()
