const db = require('../config/db');
const { getMembership } = require('../middleware/authorize');

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

exports.chat = async (req, res) => {
  console.log('Using API key:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 8) + '...' : 'MISSING');

  try {
    const { message, workspaceId } = req.body;
    if (!message || !workspaceId) {
      return res.status(400).json({ message: 'message and workspaceId are required' });
    }

    const role = await getMembership(workspaceId, req.user.id);
    if (!role) return res.status(403).json({ message: 'You are not a member of this workspace' });

    const [projects] = await db.query(
      'SELECT id, name, description FROM projects WHERE workspace_id = ?',
      [workspaceId]
    );

    const [tasks] = await db.query(
      `SELECT t.name, t.status, t.priority, t.deadline, u.name as assignee_name, p.name as project_name
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       LEFT JOIN users u ON t.assignee_id = u.id
       WHERE p.workspace_id = ?`,
      [workspaceId]
    );

    const [members] = await db.query(
      `SELECT u.name, wm.role FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = ?`,
      [workspaceId]
    );

    const context = `
You are a helpful assistant inside a task management app called Flowspace.
Answer the user's question using ONLY the data below. Be concise. If the
data doesn't contain the answer, say so — don't make anything up.

PROJECTS:
${projects.map(p => `- ${p.name}: ${p.description || 'no description'}`).join('\n')}

TASKS:
${tasks.map(t => `- "${t.name}" [${t.project_name}] status=${t.status} priority=${t.priority} assignee=${t.assignee_name || 'unassigned'} deadline=${t.deadline || 'none'}`).join('\n')}

TEAM MEMBERS:
${members.map(m => `- ${m.name} (${m.role})`).join('\n')}
`.trim();

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
  model: 'gemini-3.6-flash',
  input: `${context}\n\nUSER QUESTION: ${message}`,
  store: false,
}),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, geminiRes.statusText, errText || '(empty body)');
      return res.status(502).json({ message: 'AI service is unavailable right now' });
    }

    const data = await geminiRes.json();

    const outputStep = data.steps?.find((s) => s.type === 'model_output');
    const reply = outputStep?.content?.find((c) => c.type === 'text')?.text
      || "Sorry, I couldn't generate a response.";

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};