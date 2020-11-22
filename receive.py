import json
import sys
from time import time_ns

from gpiozero import DigitalInputDevice
import matplotlib
import matplotlib.pyplot as plt

matplotlib.use('Agg')

def get_data():
    line = DigitalInputDevice(4, False)

    data = []

    print('go')

    start_time = time_ns()
    data.append({
        'time': 0,
        'signal': line.value
    })

    while (time_ns() - start_time < 5e9):
        signal = line.value
        time = time_ns()

        if (signal != data[-1]['signal']):
            data.append({
                'time': (time - start_time) / 1e9,
                'signal': signal
            }) 

    return data

# print(get_data())        
def graph_data(data):
    t = []
    s = []

    last_signal = 0

    for point in data:
        t.append(point['time'])
        s.append(last_signal)

        t.append(point['time'])
        s.append(point['signal'])

        last_signal = point['signal']

    plt.plot(t, s)
    plt.savefig('fireplace.png')

def save_data(data, command):
    with open(command + '.json', 'w') as outfile:
        json.dump(data, outfile, indent=2)

data = get_data()
graph_data(data)
save_data(data, sys.argv[1])