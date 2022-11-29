import numpy as np
from scipy.fftpack import fft
import requests
import time
import asyncio
from sklearn.model_selection import cross_val_score
from sklearn.tree import DecisionTreeClassifier
from tornado import web, gen, ioloop
import os
import serial

BUFSIZE = 1000
FREQUENCY = 200.0
REFRESH_SPEED = 3.0

def commaed_save(path, filename, t, av):
    if os.exists(path):
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
        if curr < BUFSIZE:
            ot = np.append(t, [n*dt])
            out = np.append(out, [data[prev] * (1-((ct - t[prev]) / (t[curr] - t[prev]))
                                                ) + data[curr] * (1-((t[curr] - ct) / (t[curr] - t[prev])))])
            n += 1

    return ot, out
def assess_thresholding_function(names, ffts, freqs, func, sample_size: np.float64):
    X_vals, y_vals = get_correlated_list(names, ffts, freqs, func)
    X_vals, y_vals = np.array(X_vals), np.array(y_vals)
    combined = np.rot90(np.array([X_vals, y_vals]))
    min_value = np.min(X_vals)
    max_value = np.max(X_vals)
    step_size = (max_value - min_value) / sample_size
    lowest_entropy = None
    lowest_param_val = min_value

    for x in np.arange(min_value, max_value, step_size):
        y_pred = np.concatenate(np.ones((np.size(X_vals < x)), np.zeros(np.size(X_vals >= x))))
        print(np.size(y_pred))

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
        fr, fo = fft(av)
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
    for i in range(0, len(names) - 1):
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
    dt_clf = DecisionTreeClassifier(max_depth=get_best_max_depth(np_array_of_data=np_array_of_data, max_depth_to_check=max_depth_to_check, scoring=scoring))
    dt_clf.fit(X=np_array_of_data[:,:-1], y=np_array_of_data[:,-1])
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

model = None
calibrating = False
model_not_updated = True
ser = serial.Serial('ttyl/')

class MainHandler(web.RequestHandler):
    def get(self):
        global calibrating
        calibrating = not calibrating
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
        t, av = x.json()['t'], x.json()['av']
        int_t, int_av = generate_interpolated_data(t, av)
        freq, fourier = fft(av)

        if calibrating:
            commaed_save('pos_data', 'me', t, av)
            commaed_save('total_data', 'me', t, av)
            total_names, total_data = get_data('total_data')

            total_freq, total_fourier = get_freqs_and_fouriers(total_data)
            total_freq.append(freq)
            total_fourier.append(fourier)

            # CHIRAG: Save t and av to .csv file in both pos_data and tot_data

            model = get_decision_tree_clf(total_names,
                                        fourier,
                                        freq,
                                        funcs=[msq, jaccard, cossim, correlation, spectral_energy])

        else:
            if model == None:
                ser.write(0)
            else:
                pos_names, pos_data = get_data('total_data')
                pos_freq, pos_fourier = get_freqs_and_fouriers(total_data)

                all_funcs_data = get_single_multisim_data('me', fourier, freq, pos_names, pos_fourier, pos_freq, [msq, jaccard, cossim, correlation, spectral_energy])

                pred_ys = model.predict(all_funcs_data[:,:-1])

                prediction = np.bincount(pred_ys).argmax()

                ser.write(int(prediction))


        # else if model_not_updated:

        # WRite authentication to serial port here

    except Exception as e:
        print(e)
    # calibrating = False

async def main():
    app = make_app()
    app.listen(8888)
    pc = ioloop.PeriodicCallback(main_task, 3000)
    pc.start()
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())