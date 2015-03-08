#version 130

in vec2 fragPos;

// Ouput data
out vec3 color;

uniform vec2 lightPos;
uniform vec3 lightColor;
uniform float lightHeight;

void main()
{
    vec2 d = fragPos - (lightPos * 0.0008);
    float s = dot(normalize(vec3(d,lightHeight)), vec3(0,0,1));
	color = s * lightColor / (0.5 + 5 * (d.x * d.x + d.y * d.y));
}
