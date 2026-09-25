#version 130

in vec2 UV;
in vec3 fragmentNormal;
in vec2 fragmentPosition;

// Ouput data
out vec3 color;

uniform sampler2D texture;
uniform sampler2D normalTexture;

uniform vec3 drawColor;

uniform sampler2D shadowTex[6];
uniform vec3 lightPos[6];
uniform vec3 lightColor[6];
uniform vec3 emmissive;

const float zoom = 0.002;
const int n_lights = 6;

void main()
{
    vec3 surfaceNormal;

    if (fragmentNormal == vec3(0,0,1)) {
        surfaceNormal = normalize(2 * texture2D(normalTexture, UV * 20).rgb - 1);
    } else {
        surfaceNormal = normalize(fragmentNormal);
    }

    vec3 diffuse = vec3(0,0,0);
    for (int i = 0; i < n_lights; i++) {
        vec3 light = texture2D(shadowTex[i], UV).rgb * lightColor[i];
        vec3 d = (lightPos[i] * zoom) - vec3(fragmentPosition,0);
        float a = 1 / (1 + 5 * length(d));
        float s = clamp(dot(normalize(d), surfaceNormal), 0, 1); 
        diffuse += a * s * light;
    }

    vec3 ambient = vec3(0.02, 0.02, 0.05);
    vec3 lighting = diffuse + ambient;

    if (drawColor == vec3(0,0,0)) {
        color = lighting * texture2D(texture, UV * 20).rgb + emmissive;
    } else {
        color = lighting * drawColor.rgb + emmissive;
    }
}
