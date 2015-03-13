#version 130

in vec2 UV;
in vec3 fragmentNormal;
in vec2 fragmentPosition;

// Ouput data
out vec3 color;

uniform sampler2D texture;
uniform vec3 drawColor;

uniform sampler2D shadowTex[6];
uniform vec3 lightPos[6];

void main()
{
    const int n_lights = 6;

    vec3 diffuse = vec3(0,0,0);
    for (int i = 0; i < n_lights; i++) {
        vec3 light = texture2D(shadowTex[i], UV).rgb;
        vec3 d = vec3(fragmentPosition,0) - (lightPos[i] * 0.0008);
        float a = 1 / (1 + 3 * length(d));
        float s = clamp(dot(normalize(d), normalize(-1 * fragmentNormal)), 0, 1); 
        diffuse += a * s * light;
    }

    vec3 ambient = vec3(0.02, 0.02, 0.05);
    vec3 lighting = diffuse + ambient;

    if (drawColor == vec3(0,0,0)) {
        color = lighting * texture2D(texture, UV * 20).rgb;
    } else {
        color = lighting * drawColor.rgb;
    }
}
