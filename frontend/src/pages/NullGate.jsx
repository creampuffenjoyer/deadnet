// This page is intentionally styled as a fake generic server error.
// It is NOT DEADNET-branded. It looks like a plain Apache/Nginx 500 error page.
// The flag for CONTRACT 4 (I AM NULL) is hidden in the HTML source below.
//
// Discovery: follow the terminal hint "/null stares back / some doors need a /gate"
// or by directory enumeration.
//
// <!-- V01D{1ve_b3c0m3_s0_null} -->

export default function NullGate() {
  return (
    <html>
      <head>
        <title>500 Internal Server Error</title>
        <style dangerouslySetInnerHTML={{ __html: `
          body {
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 14px;
            color: #333;
            background: #fff;
            margin: 0;
            padding: 40px;
          }
          h1 {
            font-size: 28px;
            font-weight: normal;
            border-bottom: 1px solid #ccc;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          hr {
            border: none;
            border-top: 1px solid #ccc;
            margin: 20px 0;
          }
          address {
            font-style: italic;
            color: #666;
            font-size: 12px;
          }
        `}} />
      </head>
      <body>
        {/* V01D{1ve_b3c0m3_s0_null} */}
        <h1>Internal Server Error</h1>
        <p>The server encountered an internal error or misconfiguration and was unable to complete your request.</p>
        <p>Please contact the server administrator and inform them of the time the error occurred, and anything you might have done that may have caused the error.</p>
        <p>More information about this error may be available in the server error log.</p>
        <hr />
        <address>Apache/2.4.54 (Debian) Server at localhost Port 80</address>
      </body>
    </html>
  )
}
