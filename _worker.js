export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/upload') {
            return upload(request, env);
        }
        if (url.pathname.startsWith('/image/')) {
            return showImage(request, env);
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
};

async function upload(request, env) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const url = formData.get('url');
        const caption = formData.get('caption') || '';  // Added caption handling

        if (!file && !url) {
            return new Response(JSON.stringify({ error: 'No file or URL provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        let content;
        let name;
        if (file) {
            content = await file.arrayBuffer();
            name = file.name;
        } else {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to fetch image from URL');
            }
            content = await response.arrayBuffer();
            name = new URL(url).pathname.split('/').pop() || 'image.jpg';
        }

        const id = generateRandomId();
        await env.IMG.put(id, content, {
            metadata: { 
                name,
                caption  // Store caption with image
            }
        });

        let images = JSON.parse(await env.IMG.get('images') || '[]');
        images.unshift({ key: id, name, caption });  // Include caption in image list
        if (images.length > 100) {
            images = images.slice(0, 100);
        }
        await env.IMG.put('images', JSON.stringify(images));

        return new Response(JSON.stringify({ url: `${new URL(request.url).origin}/image/${id}` }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

async function showImage(request, env) {
    const key = request.url.split('/').pop();
    const image = await env.IMG.getWithMetadata(key);
    if (!image) {
        return new Response(JSON.stringify({ error: 'Image not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'image/jpeg');
    headers.set('Content-Disposition', `inline; filename="${image.metadata.name}"`);

    // If request is for the image, return the image
    if (request.headers.get('Accept')?.includes('image')) {
        return new Response(image.body, { headers });
    }

    // Otherwise, return an HTML page with the image and caption
    const imageUrl = new URL(request.url);
    imageUrl.searchParams.set('format', 'image');
    return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${image.metadata.name}</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                img { max-width: 100%; height: auto; }
                .caption { margin: 15px 0; font-size: 18px; }
                .tg-button {
                    display: inline-block;
                    background: #0088cc;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 4px;
                    text-decoration: none;
                    margin-top: 15px;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <img src="${imageUrl}" alt="${image.metadata.name}">
            ${image.metadata.caption ? `<div class="caption">${image.metadata.caption}</div>` : ''}
            <a href="https://t.me/share/url?url=${encodeURIComponent(imageUrl.toString())}&text=${encodeURIComponent(image.metadata.caption || '')}" 
               class="tg-button">
               Share on Telegram
            </a>
        </body>
        </html>
    `, { headers: { 'Content-Type': 'text/html' } });
}

function generateRandomId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
