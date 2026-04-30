# Use Node 18 slim as base image
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install only production dependencies
RUN npm install --production

# Bundle app source
COPY . .

# Ensure the uploads directory exists
RUN mkdir -p public/uploads

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
