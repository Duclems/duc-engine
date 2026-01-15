import http from 'http';
import url from 'url';

/**
 * Serveur temporaire pour capturer le code d'autorisation Twitch
 */
export class AuthServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
    this.authPromise = null;
    this.authResolve = null;
    this.authReject = null;
  }

  /**
   * Démarre le serveur d'authentification
   */
  start() {
    return new Promise((resolve, reject) => {
      this.authPromise = new Promise((authResolve, authReject) => {
        this.authResolve = authResolve;
        this.authReject = authReject;
      });

      this.server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        
        if (parsedUrl.pathname === '/auth/callback') {
          this.handleCallback(parsedUrl.query, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 - Page non trouvée</h1>');
        }
      });

      this.server.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`🌐 Serveur d'authentification démarré sur le port ${this.port}`);
          resolve();
        }
      });
    });
  }

  /**
   * Gère le callback d'authentification
   */
  handleCallback(query, res) {
    if (query.error) {
      console.error('❌ Erreur d\'authentification:', query.error_description || query.error);
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>❌ Erreur d'authentification</h1>
            <p>${query.error_description || query.error}</p>
            <p>Vous pouvez fermer cette fenêtre.</p>
          </body>
        </html>
      `);
      this.authReject(new Error(query.error_description || query.error));
      return;
    }

    if (query.code) {
      console.log('✅ Code d\'autorisation reçu');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>✅ Authentification réussie!</h1>
            <p>Vous pouvez fermer cette fenêtre et retourner au terminal.</p>
          </body>
        </html>
      `);
      this.authResolve(query.code);
    } else {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>❌ Code d'autorisation manquant</h1>
            <p>Vous pouvez fermer cette fenêtre.</p>
          </body>
        </html>
      `);
      this.authReject(new Error('Code d\'autorisation manquant'));
    }
  }

  /**
   * Attend le code d'autorisation
   */
  async waitForAuth() {
    return this.authPromise;
  }

  /**
   * Arrête le serveur
   */
  stop() {
    if (this.server) {
      this.server.close();
      console.log('🛑 Serveur d\'authentification arrêté');
    }
  }
}
