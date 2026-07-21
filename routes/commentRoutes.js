const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getComments, addComment, deleteComment } = require('../controllers/commentController');

/**
 * @openapi
 * /tasks/{taskId}/comments:
 *   get:
 *     summary: List comments on a task
 *     tags: [Comments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: List of comments }
 *       403: { description: Not a member of this task's workspace }
 *   post:
 *     summary: Add a comment to a task
 *     tags: [Comments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content: { type: string, maxLength: 2000 }
 *     responses:
 *       201: { description: Comment created }
 */
router.get('/:taskId/comments', auth, getComments);
router.post('/:taskId/comments', auth, addComment);

/**
 * @openapi
 * /tasks/comments/{id}:
 *   delete:
 *     summary: Delete a comment (author, manager, or admin only)
 *     tags: [Comments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Comment deleted }
 *       403: { description: Not permitted to delete this comment }
 */
router.delete('/comments/:id', auth, deleteComment);

module.exports = router;