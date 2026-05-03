# Nutze Node 20 (vollständige Version)
FROM node:20

# Erstelle App-Verzeichnis
WORKDIR /usr/src/app

# Installiere notwendige Build-Tools für native Module (sqlite3, bcrypt)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Kopiere Package-Dateien
COPY package*.json ./

# Installiere Abhängigkeiten für Produktion und baue sqlite3 aus dem Quellcode
RUN npm install --production --build-from-source=sqlite3

# Kopiere den Rest des Quellcodes
COPY . .

# Verzeichnis für Uploads sicherstellen
RUN mkdir -p public/uploads

# Port freigeben
EXPOSE 3001

# Startbefehl
CMD ["node", "index.js"]
