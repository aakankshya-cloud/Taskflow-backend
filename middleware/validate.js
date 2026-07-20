const Joi = require('joi');

const schemas = {
  signup: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    workspaceName: Joi.string().min(2).max(150).optional(),
    mode: Joi.string().valid('create', 'join').optional(),
    inviteCode: Joi.string().optional(),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  createTask: Joi.object({
    name: Joi.string().min(1).max(120).required(),
    description: Joi.string().max(1000).optional().allow('', null),
    project_id: Joi.number().required(),
    assignee_id: Joi.number().optional().allow(null),
    priority: Joi.string().valid('low', 'medium', 'high').optional(),
    deadline: Joi.string().isoDate().optional().allow(null, ''),
  }),

  // NOTE: this schema didn't exist before -- updateTask had no validation at all.
  // All fields optional since it's a partial update (PUT with COALESCE in the query).
  updateTask: Joi.object({
    name: Joi.string().min(1).max(120).optional(),
    description: Joi.string().max(1000).optional().allow('', null),
    priority: Joi.string().valid('low', 'medium', 'high').optional(),
    deadline: Joi.string().isoDate().optional().allow(null, ''),
    assignee_id: Joi.number().optional().allow(null),
  }),

  createProject: Joi.object({
    name: Joi.string().min(1).max(150).required(),
    description: Joi.string().optional().allow('', null),
    workspace_id: Joi.number().required(),
  }),

  inviteMember: Joi.object({
    email: Joi.string().email().required(),
    role: Joi.string().valid('admin', 'manager', 'member').optional(),
  }),
};

function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();

    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const messages = error.details.map((d) => d.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    next();
  };
}

module.exports = validate;