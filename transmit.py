#!/usr/bin/env python

import json
from os import path
import sys
from time import time_ns

from gpiozero import DigitalOutputDevice

def load_data(command):
    with open(path.join(path.dirname(path.realpath(__file__)), 'commands', command + '.json')) as file:
        return json.load(file)

def transmit_data(data):
    line = DigitalOutputDevice(17)

    start_time = time_ns() / 1e9
    i = 0

    while i < len(data):
        entry = data[i]
        time = entry['time']

        if time_ns() / 1e9 - start_time > time:
            line.value = entry ['signal']
            i = i + 1

    line.value = 0

data = load_data(sys.argv[1])
transmit_data(data)