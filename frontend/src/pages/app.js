import { api } from '../lib/api.js';
import { openFormModal } from '../lib/ui.js';
import { startRouter } from '../lib/router.js';
import { dashboardPage } from './dashboard.js';
import { todosPage } from './todos.js';

// #section → list page, #section/id → detail page
startRouter({
  dashboard: { list: dashboardPage },
  todos: { list: todosPage },
}, 'dashboard');

// Signed-in account + Log out at the bottom of the sidebar. (Not signed in?
// api() sends the browser to the login page.)
api('/auth/session').then(({ email, mustChangePassword }) => {
  if (mustChangePassword) location.replace('/login.html#set-password');
  document.getElementById('current-user').textContent = email;
});

// Change password: the server signs out every other browser and keeps this
// one signed in.
document.getElementById('password-btn').addEventListener('click', () => {
  openFormModal({
    title: 'Change Password',
    intro: 'Every other browser signed in to this account will be signed out.',
    fields: [
      { name: 'current_password', label: 'Current password', type: 'password', required: true },
      { name: 'new_password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters', tip: 'Required — at least 8 characters' },
      { name: 'confirm_password', label: 'Confirm new password', type: 'password', required: true, tip: 'Required — type the new password again' },
    ],
    submitLabel: 'Change Password',
    onSubmit: async (values) => {
      if (values.new_password !== values.confirm_password) throw new Error('The two new passwords don\'t match');
      await api('/auth/change-password', {
        method: 'POST',
        body: { current_password: values.current_password, new_password: values.new_password },
      });
      return 'Password changed';
    },
  });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});
