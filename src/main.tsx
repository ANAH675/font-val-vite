import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { library } from '@fortawesome/fontawesome-svg-core';
import {
  faPencilAlt,
  faTrashAlt,
  faPlus,
  faSignOutAlt,
  faUser,
  faList,
  faCircleDot,
  faCheckCircle,

  // Íconos adicionales para Dashboard:
  faTint,
  faTasks,
  faCheck,
  faWifi,
  faTimesCircle,
  faSpinner,
  faFolderOpen,
  faSync,
} from '@fortawesome/free-solid-svg-icons';

library.add(
  faPencilAlt,
  faTrashAlt,
  faPlus,
  faSignOutAlt,
  faUser,
  faList,
  faCircleDot,
  faCheckCircle,

  faTint,
  faTasks,
  faCheck,
  faWifi,
  faTimesCircle,
  faSpinner,
  faFolderOpen,
  faSync,
);

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Register from './pages/Register';
import ProtectedRoute from './routes/ProtectedRoute';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* Usé el primer path="/" para el catch-all, puedes ajustar esto */}
        <Route path="/" element={<Navigate to={"/login"} />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
        />
        {/* El último catch-all se puede eliminar si se usa el primero, pero lo dejo por si acaso */}
        <Route path='*' element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
