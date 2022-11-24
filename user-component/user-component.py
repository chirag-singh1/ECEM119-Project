import numpy as np
import asyncio
from scipy.fftpack import fft
import requests
import time
from bleak import BleakClient

BUFSIZE = 1000
FREQUENCY = 200.0
REFRESH_SPEED = 3.0

ADDRESS = "24:71:89:cc:09:05"
MODEL_NBR_UUID = "00002a24-0000-1000-8000-00805f9b34fb"

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



async def main():
    client = BleakClient(ADDRESS)
    try:
        await client.connect()
        while True:
            curr_req_start_time = time.time()
            try:
                x = requests.get('http://192.168.4.1', timeout=8)

                av, t = generate_interpolated_data(x.json()['av'], x.json()['t'])
                print(t)
                print(av)
                if time.time() - curr_req_start_time < REFRESH_SPEED * 1000:
                    time.sleep(REFRESH_SPEED - (time.time() - curr_req_start_time) / 1000)

                await client.write_gatt_char(MODEL_NBR_UUID, b'1')
            except:
                print("exception!!!!")
    except Exception as e:
        print(e)
    finally:
        await client.disconnect()

asyncio.run(main())