import numpy as np
from scipy.fftpack import fft
import requests
import time
import asyncio
from tornado import web, gen, ioloop

BUFSIZE = 1000
FREQUENCY = 200.0
REFRESH_SPEED = 3.0

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

    ot = np.array([0.0])
    out = np.array([data[0]])
    while n*dt + start_time < end_time:
        prev, curr = find_border(t, n, dt, start_time)
        ct = start_time + n * dt
        if curr < BUFSIZE:
            ot = np.append(t, [n*dt])
            out = np.append(out, [data[prev] * (1-((ct - t[prev]) / (t[curr] - t[prev]))
                                                ) + data[curr] * (1-((t[curr] - ct) / (t[curr] - t[prev])))])
            n += 1

    return out, ot

calibrating = False
class MainHandler(web.RequestHandler):
    def get(self):
        global calibrating
        calibrating = True
        self.write("Success")

def make_app():
    return web.Application([
        (r"/calibrate", MainHandler),
    ])
async def main_task():
    global calibrating
    try:
        print("Making new request")
        if calibrating:
            print("Calibration request")
        x = requests.get('http://192.168.4.1', timeout=8)

        av, t = generate_interpolated_data(x.json()['av'], x.json()['t'])
        print(t)
        print(av)
        # WRite authentication to serial port here
    except Exception as e:
        print(e)
    calibrating = False

async def main():
    app = make_app()
    app.listen(8888)
    pc = ioloop.PeriodicCallback(main_task, 3000)
    pc.start()
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
