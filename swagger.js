// swagger.js
// Serves interactive API docs at GET /api/docs.
// Run `npm install swagger-jsdoc swagger-ui-express` to use this.
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TaskFlow API',
      version: '1.0.0',
      description: 'Task & project management API — workspaces, projects, tasks, comments, and notifications.',
    },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // Reads JSDoc @openapi comments out of every route file.
  apis: ['./routes/*.js'],
};

module.exports = swaggerJsdoc(options);