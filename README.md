# Water of Leith WebMap

**Interactive map for assessing the flood protection value of green spaces**

---

## Features

- **Interactive Map** - Multi-layer map based on Leaflet

- **Building Loss Visualization** - Gradient colors display conservation value

- **Green Space Analysis** - Storage capacity display for 7 key green spaces

- **Postcode Lookup** - Enter postcode to view area information

- **Real-time Statistics** - Charts displaying loss categories and green space rankings

---

## Core Data

| Indicators | Values ​​|

|------|------|

| Total Conservation Value | £71,001,757 |

| Damage Reduction Rate | 73% |

| Green Space Storage Capacity | 267,321 m³ |

| Affected Buildings | 1,105

---

## Quick Deployment

### 1. Connect to devapps

```bash
ssh devapps

```

### 2. Create a screen session

```bash
screen -S webmap

```

### 3. Start the application

```bash
cd ~/CGS-Web-Map-main/backend
source venv/bin/activate
export ORACLE_USER=s2814398
export ORACLE_PASSWORD=20031223ZYk
export ORACLE_DSN=172.16.108.21:1842/GLRNLIVE_PRMY.is.ed.ac.uk
SCRIPT_NAME=/dev/tigisgroup3 ./venv/bin/gunicorn --bind 0.0.0.0:55430 app:app

```

### 4. Detach screen

Press `Ctrl+A` then press `D`

### 5. Access

```
https://www.geos.ed.ac.uk/dev/tigisgroup3/index.html

```
## license

This project is for academic purposes only | Edinburgh University 2025
