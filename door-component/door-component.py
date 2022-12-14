import numpy as np
import requests
import time
import asyncio
from tornado import web, gen, ioloop
import os
import serial
import traceback

from scipy.fftpack import fft
from scipy.spatial.distance import cosine
from statsmodels.tsa.stattools import acf
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import cross_val_score

BUFSIZE = 1000
FREQUENCY = 100.0
REFRESH_SPEED = 3.0

def clear_calibration(path):
    for file in os.listdir(path):
        os.remove(os.path.join(path, file))


def commaed_save(path, filename, t, av):
    print(f"Writing file: {os.path.join(path, filename)}")
    if os.path.exists(path):
        i = 0
        newp = os.path.join(path, filename + str(i) + '.txt')
        while os.path.exists(newp):
            i+=1
            newp = os.path.join(path, filename + str(i) + '.txt')
        path = newp
    np.savetxt(path, np.transpose(np.array([t, av])), delimiter=',')

def find_border(t, n, dt, start_time):
    for i in range(len(t)):
        if n*dt + start_time <= t[i]:
            return i-1, i
    return len(t)-1, len(t)

def msq(fft1, fft2, freq1, freq2):
    err = 0
    for i in range(min(fft1.size, fft2.size, freq1.size, freq2.size)):
        err += (fft1[i] - fft2[i])**2
    return err / min(freq1.size, freq2.size)

def cossim(fft1, fft2, freq1, freq2):
    min_size = min(fft1.size, fft2.size, len(freq1), len(freq2))
    return 1 - cosine(fft1[:min_size], fft2[:min_size])

def spectral_energy(fft1, fft2, freq1, freq2):
    e1 = 0
    e2 = 0
    for i in fft1:
        e1 += i
    for i in fft2:
        e2 += i
    return abs(e1-e2)

def correlation(fft1, fft2, freq1, freq2):
    min_size = min(fft1.size, fft2.size, len(freq1), len(freq2))
    corr = np.corrcoef(fft1[:min_size], fft2[:min_size])
    return corr[0][1]

def jaccard(fft1, fft2, freq1, freq2):
    intersection = 0
    union = 0
    for i in range(min(fft1.size, fft2.size, freq1.size, freq2.size)):
        union += max(fft1[i], fft2[i])
        intersection += min(fft1[i], fft2[i])
    return intersection / union

def fft(x):
    fourier = np.fft.fft(x)
    n = x.size
    timestep = 0.1
    freq = np.fft.fftfreq(n)

    return freq, abs(fourier)

def generate_interpolated_data(t, data):
    start_time = t[0]
    end_time = t[len(t)-1]
    dt = 1000.0 / FREQUENCY
    n = 1

    ot = np.array([0.0])
    out = np.array([data[0]])
    while n*dt + start_time < end_time:
        prev, curr = find_border(t, n, dt, start_time)
        ct = start_time + n * dt
        ot = np.append(t, [n*dt])
        out = np.append(out, [data[prev] * (1-((ct - t[prev]) / (t[curr] - t[prev]))
                                            ) + data[curr] * (1-((t[curr] - ct) / (t[curr] - t[prev])))])
        n += 1

    return ot, out

def truncate_even_periods(series):
    autocorr = acf(series, nlags=len(series) - 1)
    mval = 0
    mind = -1
    for i in range(20, len(autocorr)):
        if autocorr[i] > mval:
            mind = i
            mval = autocorr[i]

    return series[0:int(len(series) / mind) * mind]

def get_data(path_to_dir=os.path.join(os.getcwd(), 'data')):
    dataset = []
    for file_name in os.listdir(path_to_dir):
        dataset.append((file_name.split('.')[0][:-2] if '10' in file_name else file_name.split('.')[0][:-1], np.genfromtxt(os.path.join(path_to_dir, file_name), delimiter=',')))
    names = [x[0] for x in dataset]
    data = [x[1] for x in dataset]
    return names, data

def get_freqs_and_fouriers(list_of_data):
    freq = []
    fourier = []

    for i, item in enumerate(list_of_data):
        t, av = generate_interpolated_data(item[:,0], item[:,1])
        av = truncate_even_periods(av)
        fr, fo = fft(np.array(av))
        freq.append(fr)
        fourier.append(fo)

    return freq, fourier

def get_multisim_data(names, ffts, freqs, funcs):
    out = []
    for i in range(0, len(names) - 1):
        for j in range(i + 1, len(names)):
            cur_element_in_out = []
            for func in funcs:
                cur_element_in_out.append(func(ffts[i], ffts[j], freqs[i], freqs[j]))
            cur_element_in_out.append(1 if names[i] == names[j] else 0)
            out.append(cur_element_in_out)
    out = np.array(out)
    return out

def get_single_multisim_data(name, fft, freq, names, ffts, freqs, funcs):
    out = []
    for i in range(0, len(names)):
        cur_element_in_out = []
        for func in funcs:
            cur_element_in_out.append(func(ffts[i], fft, freqs[i], freq))
        cur_element_in_out.append(1 if names[i] == name else 0)
        out.append(cur_element_in_out)
    out = np.array(out)
    return out

def get_best_max_depth(np_array_of_data, max_depth_to_check=10, scoring='accuracy'):
    d_range = list(range(1, max_depth_to_check + 1))
    d_scores = []
    min_size = min(np.size(np_array_of_data[np_array_of_data[:,-1] == 1], 0), np.size(np_array_of_data[np_array_of_data[:,-1] == 0], 0))
    for depth in d_range:
        dt_clf = DecisionTreeClassifier(max_depth=depth)
        scores = cross_val_score(dt_clf, X=np_array_of_data[:,:-1], y=np_array_of_data[:,-1], cv=min_size, scoring=scoring)
        d_scores.append(scores.mean())
    return d_range[np.argmax(d_scores)]

def get_decision_tree_clf(names, ffts, freqs, funcs, max_depth_to_check=10, scoring='accuracy'):
    np_array_of_data = get_multisim_data(names, ffts, freqs, funcs)
    print('Got np array')
    dt_clf = DecisionTreeClassifier(max_depth=get_best_max_depth(np_array_of_data=np_array_of_data, max_depth_to_check=max_depth_to_check, scoring=scoring))
    print('Created decision tree')
    dt_clf.fit(X=np_array_of_data[:,:-1], y=np_array_of_data[:,-1])
    print('Fit complete')
    return dt_clf

def get_decision_tree_clf_processed(np_array_of_data, max_depth_to_check=10, scoring='accuracy'):
    dt_clf = DecisionTreeClassifier(max_depth=get_best_max_depth(np_array_of_data=np_array_of_data, max_depth_to_check=max_depth_to_check, scoring=scoring))
    dt_clf.fit(X=np_array_of_data[:,:-1], y=np_array_of_data[:,-1])
    return dt_clf

def get_single_dt_per_func(names, ffts, freqs, funcs, max_depth_to_check=10):
    return [get_decision_tree_clf(names=names, ffts=ffts, freqs=freqs, funcs=[func], max_depth_to_check=max_depth_to_check, scoring='accuracy') for func in funcs]

class MVDTCLassifier:
    def __init__(self, clfs=None):
        self.clfs=clfs
    def fit(self, X, y):
        self.clfs = [get_decision_tree_clf_processed(np_array_of_data=np.transpose(np.concatenate((np.array([ind_X]), np.array([y])), axis=0))) for ind_X in np.transpose(X)]
        return self

    def predict(self, X):
        return np.round(np.average(np.transpose(np.array([self.clfs[i].predict(ind_X.reshape(-1, 1)) for ind_X in np.transpose(X)])), axis=1) + 0.001)

    def get_params(self, deep=False):
        return {"clfs": self.clfs}

    def set_params(self, **parameters):
        for parameter, value in parameters.items():
            setattr(self, parameter, value)
        return self

threshold = 0.75
calibrating = False
calibration_weight = 0
calibration_freq = []
calibration_fft = []
evaluation_data = []
model_not_updated = True
evaluating = False
ser = serial.Serial('/dev/ttyACM0')
do_once = True
calibration_data = None

class MainHandler(web.RequestHandler):
    def get(self):
        global calibrating
        global evaluating
        global calibration_weight
        global calibration_freq
        global calibration_fft
        global evaluation_data
        if not calibrating:
            calibration_fft = []
            calibration_weight = 0
            calibration_freq = []
        else:
            evaluating = True
            evaluation_data = []
        calibrating = not calibrating
        self.write("Success")

def make_app():
    return web.Application([
        (r"/calibrate", MainHandler),
    ])

def weighted_avg_fft(fft1, fft2, freq1, freq2, weight1, weight2):
    freq = []
    fourier = []

    for i in range(min(len(freq1), len(freq2))):
        freq.append((freq1[i] * weight1 + freq2[i] * weight2) / (weight1 + weight2))
        fourier.append((fft1[i] * weight1 + fft2[i] * weight2) / (weight1 + weight2))

    return fourier, freq

def print_arduino_logs():
    nbytes = ser.in_waiting
    if nbytes != 0:
        print("=============ARDUINO START=============")
        print(ser.read(nbytes).decode('utf-8'))
        print("=============ARDUINO END=============")

async def main_task():
    global calibrating
    global evaluating
    global threshold
    global calibration_data
    global calibration_weight
    global calibration_freq
    global calibration_fft
    global evaluation_data
    try:
        print_arduino_logs()

        print("Making new request")

        x = requests.get('http://192.168.4.1', timeout=8)
        t, av = x.json()['t'], x.json()['av']
        print(f"Received {len(av)} data points")

        if calibrating:
            print('Processing calibration data')
            int_t, int_av = generate_interpolated_data(t, av)
            print(f"Interpolated {len(int_av)} calibration data points")
            int_av = truncate_even_periods(int_av)
            print(f"Truncated into {len(int_av)} calibration data points")
            freq, fourier = fft(int_av)
            print('Fourier Transform complete')
            if not len(calibration_fft) == 0:
                calibration_fft, calibration_freq = weighted_avg_fft(calibration_fft, fourier, calibration_freq, freq, calibration_weight, len(int_av))
            else:
                calibration_fft = list(fourier)
                calibration_freq = list(freq)
            calibration_weight += len(int_av)
            print('Data saved')

        elif evaluating:
            print('Processing calibration data')
            int_t, int_av = generate_interpolated_data(t, av)
            print(f"Interpolated {len(int_av)} evaluation data points")
            int_av = truncate_even_periods(int_av)
            print(f"Truncated into {len(int_av)} evaluation data points")
            freq, fourier = fft(int_av)
            print('Fourier Transform complete')
            iou_val = jaccard(fourier, np.array(calibration_fft), freq, np.array(calibration_freq))
            print('Jaccard IOU metric: ', iou_val)

            evaluation_data.append(iou_val)
            if len(evaluation_data) == 4:
                evaluating = False
                print('Selecting threshold', max(evaluation_data))
                threshold = max(evaluation_data)

        else:
            if calibration_weight == 0:
                print('No calibration data, writing 0')
                ser.write(0)
            else:
                int_t, int_av = generate_interpolated_data(t, av)
                print(f"Interpolated {len(int_av)} data points")
                int_av = truncate_even_periods(int_av)
                print(f"Truncated into {len(int_av)} data points")
                freq, fourier = fft(int_av)
                print('Fourier Transform complete')
                print('Running inference')
                msq_val = msq(fourier, np.array(calibration_fft), freq, np.array(calibration_freq))
                print('MSQ Output', msq_val)
                iou_val = jaccard(fourier, np.array(calibration_fft), freq, np.array(calibration_freq))
                print('Jaccard Output', iou_val)
                if iou_val >= threshold:
                    ser.write(b'1')
                    print('Prediction Value:', 1)
                else:
                    ser.write(b'0')
                    print('Prediction Value:', 0)
                print('Wrote prediction')

    except Exception as e:
        print(e)
        traceback.print_exc()
    # calibrating = False

async def main():
    app = make_app()
    app.listen(8888)
    pc = ioloop.PeriodicCallback(main_task, 3000)
    pc.start()
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())