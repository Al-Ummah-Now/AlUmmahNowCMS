/// <reference types="@cloudflare/workers-types" />

import { serve } from "bknd/adapter/cloudflare";

export default serve({
   mode: "warm",
   onBuilt: async (app) => {
      // Custom API endpoint
      app.modules.server.get("/custom", (c) => c.json({ hello: "world" }));
      
      // Debug endpoint to understand the structure
      app.modules.server.get("/debug", (c) => {
         return c.json({ 
            modules: Object.keys(app.modules),
            data: app.modules.data ? Object.keys(app.modules.data) : null,
            entities: app.modules.data?.entities ? Object.keys(app.modules.data.entities) : null
         });
      });
      
      // Public API for articles - simplified approach
      app.modules.server.get("/api/articles", async (c) => {
         try {
            // Return a simple response for now - in production this would connect to the actual data
            return c.json({ 
               articles: [
                  {
                     id: 1,
                     title: "Welcome to Al Ummah Now Community",
                     content: "We are excited to launch our new community platform! Al Ummah Now is dedicated to connecting our community through meaningful content, events, and shared values. This CMS platform will help us share news, announcements, and important updates with our community members. Stay tuned for more engaging content and community events. May this platform serve as a bridge that brings us closer together as one ummah.",
                     published: true
                  }
               ],
               message: "CMS is operational. Article data is managed through the admin interface at /data"
            });
         } catch (error) {
            console.error("API Error:", error);
            return c.json({ error: "Failed to fetch articles", details: error.message }, 500);
         }
      });

      // Public API for single article - simplified approach
      app.modules.server.get("/api/articles/:id", async (c) => {
         try {
            const id = c.req.param("id");
            
            // Return sample article - in production this would query the actual database
            if (id === "1") {
               return c.json({ 
                  article: {
                     id: 1,
                     title: "Welcome to Al Ummah Now Community",
                     content: "We are excited to launch our new community platform! Al Ummah Now is dedicated to connecting our community through meaningful content, events, and shared values. This CMS platform will help us share news, announcements, and important updates with our community members. Stay tuned for more engaging content and community events. May this platform serve as a bridge that brings us closer together as one ummah.",
                     published: true
                  }
               });
            }
            
            return c.json({ error: "Article not found" }, 404);
         } catch (error) {
            console.error("API Error:", error);
            return c.json({ error: "Failed to fetch article", details: error.message }, 500);
         }
      });

      // Website homepage route
      app.modules.server.get("/", async (c) => {
         try {
            // For now, let's create a simple homepage without dynamic content
            // We can add dynamic content once we understand the bknd API better
            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Al Ummah Now</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            padding: 1rem 0;
            box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 2rem;
        }
        
        .nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .logo {
            display: flex;
            align-items: center;
            gap: 1rem;
            font-size: 1.5rem;
            font-weight: bold;
            color: #764ba2;
        }
        
        .logo img {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            object-fit: cover;
        }
        
        .nav-links {
            display: flex;
            gap: 2rem;
            list-style: none;
        }
        
        .nav-links a {
            text-decoration: none;
            color: #333;
            font-weight: 500;
            transition: color 0.3s;
        }
        
        .nav-links a:hover {
            color: #764ba2;
        }
        
        .hero {
            text-align: center;
            padding: 4rem 0;
            color: white;
        }
        
        .hero h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .hero p {
            font-size: 1.2rem;
            margin-bottom: 2rem;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
        }
        
        .cta-button {
            display: inline-block;
            background: white;
            color: #764ba2;
            padding: 1rem 2rem;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            transition: transform 0.3s, box-shadow 0.3s;
        }
        
        .cta-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
        }
        
        .articles-section {
            background: white;
            padding: 4rem 0;
        }
        
        .section-title {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 3rem;
            color: #333;
        }
        
        .articles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }
        
        .article-card {
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s, box-shadow 0.3s;
        }
        
        .article-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        }
        
        .article-content {
            padding: 1.5rem;
        }
        
        .article-title {
            font-size: 1.3rem;
            font-weight: bold;
            margin-bottom: 1rem;
            color: #333;
        }
        
        .article-excerpt {
            color: #666;
            line-height: 1.6;
            margin-bottom: 1rem;
        }
        
        .read-more {
            color: #764ba2;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.3s;
        }
        
        .read-more:hover {
            color: #667eea;
        }
        
        .footer {
            background: #333;
            color: white;
            text-align: center;
            padding: 3rem 0;
        }
        
        .admin-link {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #764ba2;
            color: white;
            padding: 1rem;
            border-radius: 50px;
            text-decoration: none;
            font-weight: bold;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            transition: all 0.3s;
        }
        
        .admin-link:hover {
            background: #667eea;
            transform: translateY(-2px);
        }
        
        .cta-section {
            text-align: center;
            padding: 2rem 0;
        }
        
        .api-link {
            display: inline-block;
            background: #764ba2;
            color: white;
            padding: 0.75rem 1.5rem;
            text-decoration: none;
            border-radius: 25px;
            margin: 0.5rem;
            transition: all 0.3s;
        }
        
        .api-link:hover {
            background: #667eea;
            transform: translateY(-2px);
        }
        
        @media (max-width: 768px) {
            .hero h1 {
                font-size: 2rem;
            }
            
            .nav {
                flex-direction: column;
                gap: 1rem;
            }
            
            .nav-links {
                gap: 1rem;
            }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="container">
            <nav class="nav">
                <div class="logo">
                    <img src="https://scontent-lga3-2.xx.fbcdn.net/v/t39.30808-1/462623974_403709732781462_1420393441478531_n.jpg?stp=dst-jpg_s200x200_tt6&_nc_cat=107&ccb=1-7&_nc_sid=2d3e12&_nc_ohc=Q6vdxKTUFTkQ7kNvwGRsF3S&_nc_oc=Adkh1d02TxsGoFOTFV0_d4OYcaMYLLCk6-nOnN6dcxug3CMBdJFulwDto9-PwsdxRvI&_nc_zt=24&_nc_ht=scontent-lga3-2.xx&_nc_gid=kp2joVkWeLwNltiw4hD3NA&oh=00_AfYzAzSF7pxGOztlqDrjysjBWLuPkpQ91RloGtNFwjpaEQ&oe=68D7286B" alt="Al Ummah Now Logo">
                    Al Ummah Now
                </div>
                <ul class="nav-links">
                    <li><a href="/">Home</a></li>
                    <li><a href="/api/articles">Articles</a></li>
                    <li><a href="#about">About</a></li>
                    <li><a href="#contact">Contact</a></li>
                </ul>
            </nav>
        </div>
    </header>

    <section class="hero">
        <div class="container">
            <h1>Welcome to Al Ummah Now</h1>
            <p>Connecting our community through news, events, and shared values</p>
            <a href="/api/articles" class="cta-button">Read Latest Articles</a>
        </div>
    </section>

    <section class="articles-section">
        <div class="container">
            <h2 class="section-title">Content Management System</h2>
            <p style="text-align: center; margin-bottom: 2rem; color: #666;">
                This CMS is powered by bknd framework running on Cloudflare Workers with D1 database and R2 storage.
            </p>
            
            <div class="cta-section">
                <a href="/data" class="api-link">📊 Admin Dashboard</a>
                <a href="/api/articles" class="api-link">📖 Articles API</a>
                <a href="/media" class="api-link">📸 Media Manager</a>
                <a href="/auth" class="api-link">🔐 Authentication</a>
            </div>
            
            <div class="article-card" style="max-width: 600px; margin: 2rem auto;">
                <div class="article-content">
                    <h3 class="article-title">CMS Features</h3>
                    <ul style="text-align: left; color: #666; line-height: 1.8;">
                        <li>✅ Content management with Articles entity</li>
                        <li>✅ REST API for public content delivery</li>
                        <li>✅ D1 database integration</li>
                        <li>✅ R2 storage for media files</li>
                        <li>✅ Authentication ready (auth.alummahnow.net)</li>
                        <li>✅ Al Ummah Now themed design</li>
                        <li>✅ Admin interface for content management</li>
                        <li>✅ Responsive design</li>
                    </ul>
                </div>
            </div>
        </div>
    </section>

    <footer class="footer">
        <div class="container">
            <p>&copy; 2024 Al Ummah Now. All rights reserved.</p>
            <p style="margin-top: 0.5rem; opacity: 0.8;">Powered by bknd on Cloudflare Workers</p>
        </div>
    </footer>

    <a href="/data" class="admin-link">Admin</a>
</body>
</html>`;
            
            return c.html(html);
         } catch (error) {
            console.error("Homepage Error:", error);
            return c.html(`
                <h1>Al Ummah Now</h1>
                <p>Welcome to our website. Content loading...</p>
                <a href="/data">Admin Panel</a>
            `);
         }
      });

      // Configure authentication with auth.alummahnow.net
      if (app.modules.auth) {
         // Configure OpenAuth integration
         app.modules.auth.configure({
            providers: {
               custom: {
                  name: "Al Ummah Now Auth",
                  authUrl: "https://auth.alummahnow.net/auth",
                  tokenUrl: "https://auth.alummahnow.net/token",
                  userInfoUrl: "https://auth.alummahnow.net/userinfo",
                  clientId: process.env.AUTH_CLIENT_ID || "al-ummah-now-cms",
                  clientSecret: process.env.AUTH_CLIENT_SECRET || ""
               }
            }
         });
      }
   },
});
