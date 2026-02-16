// Configuración para usar HTTPS en el servidor de desarrollo
// Cambia las rutas si es necesario
export const SSL_OPTIONS = {
  key: await fs.readFile(path.join(__dirname, 'localhost-key.pem')),
  cert: await fs.readFile(path.join(__dirname, 'localhost-cert.pem'))
};
