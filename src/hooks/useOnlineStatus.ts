import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  // Estado inicial: usa navigator.onLine (API nativa del navegador)
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    // Función que se ejecuta cuando HAY conexión
    function handleOnline() {
      console.log('Conexión restaurada');
      setIsOnline(true);
    }

    // Función que se ejecuta cuando NO HAY conexión
    function handleOffline() {
      console.log('❌ Sin conexión');
      setIsOnline(false);
    }

    // Función que verifica el estado actual
    function checkOnlineStatus() {
      const currentStatus = navigator.onLine;
      if (currentStatus !== isOnline) {
        setIsOnline(currentStatus);
        console.log(currentStatus ? 'Online detectado' : 'Offline detectado');
      }
    }

    // Escucha eventos del navegador (cambios instantáneos)
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Verifica cada 2 segundos
    const interval = setInterval(checkOnlineStatus, 2000);

    // Limpieza: remueve los listeners y el interval
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [isOnline]); // Dependencia para que checkOnlineStatus compare correctamente

  return isOnline;
}